# Deploying the API to ECS Fargate (Express Mode)

Runbook for standing up `backend/` on AWS. **Nothing here has been applied** — these are drafts for review, and every step is one you run.

Account `582908772109`, region `us-east-2` (matched to the Supabase project: `JwtAuthGuard` calls Supabase Auth on every request, so a cross-region hop would tax every call).

## Why Express Mode

The original draft of this file built the VPC, ALB, target group, listeners, ACM certificate and Route 53 records by hand. That path needs a domain you own, because **ACM will not issue a certificate for an `*.elb.amazonaws.com` hostname** — so a bare ALB can only serve HTTP, and iOS App Transport Security blocks plain HTTP from a release build.

ECS Express Mode removes that entirely: it provisions the load balancer *and* an AWS-managed ACM certificate, and hands you a working HTTPS URL. No domain required.

It is not a black box. It creates ordinary resources in your account — cluster, task definition, Fargate service, ALB, target group, security groups, auto-scaling policies, log group, CloudWatch alarms — all of which you can inspect and modify afterwards. You can attach a custom domain later whenever you want one.

(AWS App Runner would have been the other option; it stopped accepting new customers on 30 April 2026.)

## Cost

| Resource | Monthly |
|---|---|
| Application Load Balancer (created by Express Mode) | **~$16** — standing charge, traffic or not |
| Fargate, 1 task @ 0.25 vCPU / 0.5 GB | ~$9 |
| RDS `db.t4g.micro` | ~$12 |
| ECR, CloudWatch Logs, SSM Standard | ~$1 |
| **Total** | **~$38/mo** |

Express Mode does not make the ALB cheaper for a single service, though it will share one across up to 25 services on the same subnet configuration if you add more later.

## Order of operations

### 1. Store secrets in SSM

```bash
aws ssm put-parameter --profile liftoff --region us-east-2 \
  --name /liftoff/prod/DATABASE_URL --type SecureString \
  --value "postgres://...rds.amazonaws.com:5432/liftoff"

aws ssm put-parameter --profile liftoff --region us-east-2 \
  --name /liftoff/prod/SUPABASE_PROJECT_URL --type String \
  --value "https://hqvnvnuuczqlpffebuui.supabase.co"

aws ssm put-parameter --profile liftoff --region us-east-2 \
  --name /liftoff/prod/SUPABASE_SECRET_KEY --type SecureString \
  --value "<service-role key>"
```

Prefix the command with a space so the secret stays out of shell history. Supabase keeps only auth after the port, but the key is still the service-role key — treat it accordingly.

### 2. IAM roles

Four, and the distinction between the first three is the part worth understanding.

| Role | Assumed by | Purpose |
|---|---|---|
| `liftoff-api-task-execution` | `ecs-tasks.amazonaws.com` | the **agent**, before your container starts: pull image, read SSM, write logs |
| `liftoff-api-task` | `ecs-tasks.amazonaws.com` | **your code**. No permissions — it makes no AWS calls |
| `ecsInfrastructureRoleForExpressServices` | **`ecs.amazonaws.com`** | Express Mode itself: creates the ALB, target groups, security groups, certificate, scaling |
| `liftoff-github-deploy` | GitHub OIDC | CI: push image, roll the service |

Note the third one's principal is `ecs.amazonaws.com`, **not** `ecs-tasks.amazonaws.com`. Getting that wrong fails at service creation with an error that doesn't name the role.

```bash
# Execution role — the agent
aws iam create-role --profile liftoff --role-name liftoff-api-task-execution \
  --assume-role-policy-document file://infra/iam/task-role-trust-policy.json
aws iam attach-role-policy --profile liftoff --role-name liftoff-api-task-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --profile liftoff --role-name liftoff-api-task-execution \
  --policy-name read-secrets --policy-document file://infra/iam/task-execution-role.json

# Task role — your code. Trust policy only, no permissions attached.
aws iam create-role --profile liftoff --role-name liftoff-api-task \
  --assume-role-policy-document file://infra/iam/task-role-trust-policy.json

# Infrastructure role — Express Mode
aws iam create-role --profile liftoff --role-name ecsInfrastructureRoleForExpressServices \
  --assume-role-policy-document file://infra/iam/express-infrastructure-role-trust-policy.json
aws iam attach-role-policy --profile liftoff --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
```

> The `_comment` keys in these JSON files explain the reasoning but are **not valid IAM syntax**. Strip them before applying. `infra/iam/task-role.json` is documentation only — an empty policy is invalid, which is itself the confirmation that you attach nothing.

Then the GitHub OIDC provider (once per account) and `liftoff-github-deploy`, using `github-oidc-trust-policy.json` as trust and `github-deploy-role.json` inline:

```bash
aws iam create-open-id-connect-provider --profile liftoff \
  --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
```

**Read the `sub` condition before applying.** As written it permits only workflows on `main` of this repo; widening it to `repo:chrrstiang/liftoff-app:*` would let any pull request, including one from a fork, push to your ECR.

### 3. ECR and the log group

```bash
aws ecr create-repository --profile liftoff --region us-east-2 \
  --repository-name liftoff-api --image-scanning-configuration scanOnPush=true

aws logs create-log-group --profile liftoff --region us-east-2 --log-group-name /ecs/liftoff-api
aws logs put-retention-policy --profile liftoff --region us-east-2 \
  --log-group-name /ecs/liftoff-api --retention-in-days 30
```

Set retention — the default is "never expire", which bills quietly forever. The log group must exist before the first task starts, or it fails with a log-driver error that reads like a networking problem.

### 4. RDS

`db.t4g.micro`, private, no public access, in the same VPC Express Mode will use (the default VPC unless you tell it otherwise).

The one thing to get right: **the RDS security group must allow 5432 from the task security group** — as a security-group reference, not a CIDR. Express Mode creates that task security group, so this is a step you do *after* the service exists, using the group id from step 6.

### 5. Push an image and register the task definition

Express Mode's `--primary-container` shorthand cannot express secrets, so the SSM injection needs a custom task definition. `infra/ecs/task-definition.json` is that.

```bash
aws ecr get-login-password --profile liftoff --region us-east-2 \
  | docker login --username AWS --password-stdin 582908772109.dkr.ecr.us-east-2.amazonaws.com
docker build -t 582908772109.dkr.ecr.us-east-2.amazonaws.com/liftoff-api:bootstrap ./backend
docker push 582908772109.dkr.ecr.us-east-2.amazonaws.com/liftoff-api:bootstrap

aws ecs register-task-definition --profile liftoff --region us-east-2 \
  --cli-input-json file://infra/ecs/task-definition.json
```

### 6. Create the Express service

```bash
aws ecs create-express-gateway-service --profile liftoff --region us-east-2 \
  --service-name liftoff-api \
  --task-definition liftoff-api \
  --execution-role-arn arn:aws:iam::582908772109:role/liftoff-api-task-execution \
  --infrastructure-role-arn arn:aws:iam::582908772109:role/ecsInfrastructureRoleForExpressServices \
  --health-check-path /health
```

**`--health-check-path` is not optional here.** It defaults to `/ping`, which this API does not serve, so every task would fail its health check and cycle forever. `/health` deliberately does not touch the database — a check that queries Postgres fails whenever Postgres hiccups, which makes the load balancer replace healthy tasks and turns a blip into an outage.

Then read the URL back:

```bash
aws ecs describe-express-gateway-service --profile liftoff --region us-east-2 \
  --cluster default --service-name liftoff-api
```

### 7. Wire up CI

Repository → Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::582908772109:role/liftoff-github-deploy` |
| `API_BASE_URL` | the HTTPS URL from step 6 |

Neither is sensitive, so variables rather than secrets — and they're visible in logs, which helps when debugging. `.github/workflows/deploy.yml` skips itself with a warning until `AWS_DEPLOY_ROLE_ARN` is set.

Once the service exists, tighten `ecs:UpdateExpressGatewayService` in `github-deploy-role.json` from `Resource: "*"` to the real service ARN.

### 8. Point the app at it

Set `EXPO_PUBLIC_API_URL` to the Express Mode URL in `frontend/.env`, restart Metro with `--clear`, and **complete profile creation from a physical device** — the simulator resolves `localhost`, which is exactly the failure that masks.

⚠️ That URL is compiled into every build you distribute. It is stable for the life of the service, but if you ever recreate the service the hostname changes and every installed copy breaks. That is the one thing a custom domain buys you, and Express Mode supports adding one later.

## Verifying

```bash
curl https://<express-url>/health          # {"status":"ok",...}
docker build -t liftoff-api ./backend && docker run --rm -p 8000:8000 --env-file backend/.env liftoff-api
curl localhost:8000/health
```

## Policy validation

`task-execution-role.json` and `github-deploy-role.json` both return **zero findings** from AWS Access Analyzer (strip `_comment` first):

```bash
aws accessanalyzer validate-policy --profile liftoff --region us-east-2 \
  --policy-type IDENTITY_POLICY --policy-document file://<policy>.json
```

Two results that look like problems and aren't: `MISSING_RESOURCE` on the trust policies (there's no trust-policy validation mode, and a trust policy legitimately omits `Resource`), and `MISSING_STATEMENT` on `task-role.json` (that's the point — attach nothing).

## When it goes wrong

| Symptom | Cause |
|---|---|
| Tasks cycle, health checks fail | `--health-check-path` left at the `/ping` default |
| `ResourceInitializationError: unable to pull secrets` | execution role missing `ssm:GetParameters` or `kms:Decrypt` — Decrypt is needed even for the default `aws/ssm` key |
| Service creation fails, role not named | infrastructure role trust principal is `ecs-tasks.amazonaws.com` instead of `ecs.amazonaws.com` |
| API cannot reach the database | RDS security group doesn't allow 5432 from the Express-created task security group |
| `AccessDenied` on deploy | deploy role missing `iam:PassRole` for all three roles, or missing `ecs.amazonaws.com` in the `PassedToService` condition |
| Deploy green but API broken | the settle-polling loop was removed from `deploy.yml` |
| `Token has expired` on any command | `aws sso login --profile liftoff` |

Logs are in CloudWatch `/ecs/liftoff-api`. For a task that won't start, the ECS console's **Stopped tasks** tab gives a more specific reason than the logs do.
