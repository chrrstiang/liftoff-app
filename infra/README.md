# Deploying the API to ECS Fargate

Runbook for standing up `backend/` on AWS. **Nothing here has been applied** — these files are drafts for review, and every step below is one you run.

Account `582908772109`, region `us-east-2` (chosen to match the Supabase project: `JwtAuthGuard` calls `supabase.auth.getUser()` on every request, so a cross-region hop would tax every single call).

## Cost, before anything else

| Resource | Monthly |
|---|---|
| Application Load Balancer | **~$16** — a standing charge, whether or not traffic hits it |
| Fargate, 1 task at 0.25 vCPU / 0.5 GB | ~$9 |
| ECR storage, CloudWatch Logs, SSM Standard | ~$1 |
| **Total** | **~$26/mo** |

The ALB is the bulk of it and it accrues from the moment it exists. Student credits should absorb this comfortably, but know the number before you create it. If you only need "reachable on the internet" and not the ECS learning, App Runner from the same image is roughly $5/mo and has no standing load-balancer cost.

## Why console-first, not Terraform

Build the VPC, cluster, and ALB **in the console once**. The point of this exercise is learning the object model, and clicking through it teaches how subnets, security groups, target groups, and listeners actually relate far better than applying someone else's HCL. Full IaC is a genuine week of work and it's the least valuable week on the plan.

The task definition is the exception — it's committed (`infra/ecs/task-definition.json`) because CI needs to render a new revision on every deploy.

Revisit Terraform once the service is stable and you'd rather not click through it a second time.

## Order of operations

Do these in order. Several later steps fail confusingly if an earlier one is missing.

### 1. Buy the domain — do this first

`EXPO_PUBLIC_API_URL` is **inlined at bundle time**. If you ship a build pointing at `liftoff-api-123.us-east-2.elb.amazonaws.com` and later move to `api.yourdomain.com`, **every install you handed someone is permanently broken**. iOS ATS also blocks plain HTTP from a release build, so the certificate isn't optional either.

Route 53 is simplest — certificate validation and the ALB alias record then stay in one place.

### 2. Store the Supabase credentials in SSM

```bash
aws ssm put-parameter --profile liftoff --region us-east-2 \
  --name /liftoff/prod/SUPABASE_PROJECT_URL --type String \
  --value "https://hqvnvnuuczqlpffebuui.supabase.co"

aws ssm put-parameter --profile liftoff --region us-east-2 \
  --name /liftoff/prod/SUPABASE_SECRET_KEY --type SecureString \
  --value "<the service-role key>"
```

Run the second one so it doesn't land in your shell history — a leading space works in most shells, or use `--value "$(cat)"` and paste. **This is the service-role key: it bypasses RLS entirely.** Standard parameters are free; SecureString with the default `aws/ssm` key costs nothing extra.

### 3. Create the IAM roles

Three roles. The split between the first two is the part worth understanding, and conflating them is the most common ECS IAM mistake.

| Role | Whose identity | Needs |
|---|---|---|
| `liftoff-api-task-execution` | the **ECS agent**, before your container starts | pull image, read SSM secrets, write logs |
| `liftoff-api-task` | **your application code** | nothing |
| `liftoff-github-deploy` | **GitHub Actions** | push to ECR, roll the service |

```bash
# Execution role — the agent
aws iam create-role --profile liftoff --role-name liftoff-api-task-execution \
  --assume-role-policy-document file://infra/iam/task-role-trust-policy.json
aws iam attach-role-policy --profile liftoff --role-name liftoff-api-task-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --profile liftoff --role-name liftoff-api-task-execution \
  --policy-name read-supabase-secrets \
  --policy-document file://infra/iam/task-execution-role.json

# Task role — your code. Trust policy only, no permissions.
aws iam create-role --profile liftoff --role-name liftoff-api-task \
  --assume-role-policy-document file://infra/iam/task-role-trust-policy.json
```

> The `_comment` keys in these JSON files explain the reasoning but are **not valid IAM policy syntax**. Strip them before applying, or apply through the console where you'll be pasting the `Version`/`Statement` body anyway. `infra/iam/task-role.json` is deliberately an empty statement list — the app makes no AWS calls, and giving it the execution role's SSM access "to be safe" would let application code read the service-role key directly, defeating the entire split.

For the OIDC provider (one time per account):

```bash
aws iam create-open-id-connect-provider --profile liftoff \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

Then create `liftoff-github-deploy` with `infra/iam/github-oidc-trust-policy.json` as its trust policy and `infra/iam/github-deploy-role.json` as an inline policy. **Read the `sub` condition before applying** — as written it permits only workflows on `main` of this one repo. Widening it to `repo:chrrstiang/liftoff-app:*` would let any pull request, including one from a fork, push images to your ECR.

### 4. ECR repository

```bash
aws ecr create-repository --profile liftoff --region us-east-2 \
  --repository-name liftoff-api --image-scanning-configuration scanOnPush=true
```

### 5. CloudWatch log group

The task definition names `/ecs/liftoff-api`. If it doesn't exist, tasks fail to start with a log-driver error that reads like a networking problem.

```bash
aws logs create-log-group --profile liftoff --region us-east-2 --log-group-name /ecs/liftoff-api
aws logs put-retention-policy --profile liftoff --region us-east-2 \
  --log-group-name /ecs/liftoff-api --retention-in-days 30
```

Set retention. The default is "never expire", which quietly bills forever.

### 6. Network and load balancer — in the console

- **Security groups, two of them.** ALB SG allows 443 (and 80 to redirect) from `0.0.0.0/0`. Task SG allows **8000 from the ALB security group only** — as a source group reference, not a CIDR. This is the step to get right: opening 8000 to the world puts the container on the public internet next to the load balancer instead of behind it.
- **ACM certificate** for `api.yourdomain.com`, in **us-east-2** (an ALB can only use a certificate from its own region — a us-east-1 cert is the classic trap here, and it's only correct for CloudFront). Validate by DNS.
- **Target group**, type **IP** (required for Fargate `awsvpc`), protocol HTTP, port 8000, health check path **`/health`**. That endpoint deliberately doesn't touch Supabase, so a database blip won't cause the ALB to deregister healthy tasks.
- **ALB**, internet-facing, across at least two public subnets in different AZs. HTTPS:443 listener → target group; HTTP:80 listener → redirect to 443.
- **Route 53** A record, alias to the ALB.

### 7. Cluster, task definition, service

```bash
aws ecs create-cluster --profile liftoff --region us-east-2 --cluster-name liftoff-cluster

# Strip the _comment keys first if you copied them anywhere.
aws ecs register-task-definition --profile liftoff --region us-east-2 \
  --cli-input-json file://infra/ecs/task-definition.json
```

Create the service in the console so you can pick the subnets, security group, and target group from lists: launch type Fargate, 1 task, **private subnets if you have NAT, otherwise public subnets with "Assign public IP" enabled** — a Fargate task in a public subnet without a public IP cannot reach ECR and fails to pull with a timeout that looks like a permissions problem. Attach it to the target group from step 6.

Name it `liftoff-api`, in cluster `liftoff-cluster` — `github-deploy-role.json` scopes `ecs:UpdateService` to exactly that ARN.

### 8. Wire up CI

Repository → Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::582908772109:role/liftoff-github-deploy` |
| `API_BASE_URL` | `https://api.yourdomain.com` |

These are variables, not secrets — neither is sensitive, and variables are visible in logs, which helps when debugging. `.github/workflows/deploy.yml` skips itself with a warning until `AWS_DEPLOY_ROLE_ARN` is set.

### 9. Point the app at it

Set `EXPO_PUBLIC_API_URL=https://api.yourdomain.com` in `frontend/.env`, restart Metro with `--clear` (a running server won't pick it up), and **complete profile creation from a physical device**. Not the simulator — the simulator resolves `localhost`, which is exactly the failure this masks.

## Policy validation, and one false positive

The two permissions policies were checked with AWS Access Analyzer and come back clean:

```bash
aws accessanalyzer validate-policy --profile liftoff --region us-east-2 \
  --policy-type IDENTITY_POLICY --policy-document file://<policy>.json
```

`task-execution-role.json` and `github-deploy-role.json` → **zero findings** (strip `_comment` first).

Two results that look like problems but aren't:

- **`MISSING_RESOURCE` on both trust policies.** `validate-policy` has no trust-policy mode, so they have to be checked as `RESOURCE_POLICY` — and a trust policy legitimately omits `Resource`, because the role it's attached to *is* the resource. Expected artifact, not a defect.
- **`CONFIRM_AUDIENCE_CLAIM_TYPE` on the OIDC trust policy.** A generic note that fires whenever the `aud` key appears. It warns against a qualifier (`ForAnyValue:` / `ForAllValues:`); the policy uses plain `StringEquals`, which is the correct single-valued form.

`task-role.json` returns `MISSING_STATEMENT`, which is the point — see the comment in that file. Attach nothing.

## Verifying

```bash
curl https://api.yourdomain.com/health
```

Should return `{"status":"ok","uptime":<n>,"timestamp":"..."}`.

Locally, the same image CI builds:

```bash
docker build -t liftoff-api ./backend
docker run --rm -p 8000:8000 --env-file backend/.env liftoff-api
curl localhost:8000/health
```

## When it goes wrong

Nearly every first-deploy failure is one of these:

| Symptom | Cause |
|---|---|
| `ResourceInitializationError: unable to pull secrets` | execution role missing `ssm:GetParameters` or `kms:Decrypt` — the Decrypt grant is needed even for the default `aws/ssm` key |
| Task stuck in PENDING, then fails to pull image | no route to ECR: private subnet without NAT, or public subnet without "Assign public IP" |
| Target group health checks fail, tasks cycle | task SG doesn't allow 8000 from the ALB SG, or health check path isn't `/health` |
| ALB returns 503 | no healthy targets — check the task logs in `/ecs/liftoff-api` first |
| `AccessDenied` on `RegisterTaskDefinition` | deploy role missing `iam:PassRole` for the two task roles |
| Deploy goes green but the API is broken | you removed `wait-for-service-stability` — without it, a crash-looping container still reports success |

Logs are in CloudWatch `/ecs/liftoff-api`. For a task that won't start, the ECS console's **Stopped tasks** tab gives a reason string that's usually more specific than the logs.
