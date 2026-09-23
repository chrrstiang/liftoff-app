# Running LiftOff locally

Getting both halves up on a fresh machine. For how the pieces fit together see `ARCHITECTURE.md`; for deploying the API see `infra/README.md`.

## Prerequisites

- **Node 20** — pinned in `.nvmrc` and what CI uses.
- **Docker** — for the local Postgres. Nothing else needs it.
- **A Supabase project** — used for authentication and two image buckets (`avatars`, `conversations`). It is *not* the database; see `ARCHITECTURE.md` §1.
- **Expo Go, or an iOS/Android simulator.**

## The repo is two independent npm projects

There is no root `package.json`, no workspaces, no Turborepo. Nothing is runnable from the repo root.

```
liftoff-app/
├── frontend/    Expo / React Native app
├── backend/     NestJS REST API
└── infra/       AWS deployment runbook and task definitions
```

**`cd frontend` or `cd backend` before any npm command.** CI does this explicitly with `working-directory:`, and the two packages have different conventions — quotes, import style, TS strictness, whether Prettier is enforced. Guessing wrong is silent.

## 1. Database

From `backend/`:

```bash
npm run db:up        # docker compose up -d
npm run db:migrate   # drizzle-kit migrate — 18 tables, then the 5 views
npm run db:seed      # federations, divisions, weight classes
npm run db:verify    # 18 assertions that the port is sound
```

That gives you Postgres on **`127.0.0.1:55440`** (an unusual port on purpose, so it cannot collide with a system Postgres on 5432):

```
DATABASE_URL=postgres://postgres@127.0.0.1:55440/liftoff
```

`npm run db:down` stops it and **destroys the volume** — it is `docker compose down -v`. After changing `src/db/schema.ts`, run `npm run db:generate` to produce a migration, then `db:migrate` to apply it.

`backend/src/db/schema.ts` is the source of truth for the schema. It is hand-written rather than `drizzle-kit pull`ed, deliberately dropping the Supabase-isms the port left behind.

## 2. Backend

From `backend/`:

```bash
npm ci
cp .env.example .env     # then fill it in
npm run start:dev        # nest start --watch → http://0.0.0.0:8000
```

`.env.example` is the template. These are the variables actually read in code:

| Variable | Needed | Notes |
|---|---|---|
| `SUPABASE_PROJECT_URL` | **yes** | `SupabaseService` throws at construction without it |
| `SUPABASE_SECRET_KEY` | **yes** | the **service-role** key — same, the app will not boot |
| `DATABASE_URL` | **yes** locally | or the `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` set, which is what ECS uses since RDS manages the password in Secrets Manager |
| `SUPABASE_JWT_SECRET` | recommended | with it, `JwtAuthGuard` verifies tokens locally with HMAC; without it every authenticated request falls back to a network call to Supabase |
| `SUPABASE_JWT_ISSUER` | recommended | the exact `iss` on the project's access tokens, e.g. `https://<ref>.supabase.co/auth/v1`. When set, `JwtAuthGuard` requires it; when unset the claim is not checked. Read it off a real token rather than assembling it — see below |
| `PORT` / `HOST` | no | default `8000` / `0.0.0.0` |

The two Supabase variables failing loudly at construction is deliberate — a fast, obvious failure beats a server that boots and then 500s on every authenticated request.

⚠️ **`SUPABASE_SECRET_KEY` is the service-role key.** Never log it, and never move it into anything prefixed `EXPO_PUBLIC_`.

**`SUPABASE_JWT_ISSUER` is opt-in on purpose, and it is not derived from `SUPABASE_PROJECT_URL`.** Assembling it looks obvious and is a guess — a custom auth domain or a trailing slash makes *every authenticated request in that environment* return 401, and nothing in CI would catch it first: the e2e job does not set `SUPABASE_JWT_SECRET`, so it exercises the remote fallback and never reaches the local verifier. Get the value by signing in and decoding the access token:

```bash
# the middle segment of the JWT, base64url-decoded
node -e 'console.log(JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url")).iss)' <token>
```

`test/auth-claims.e2e-spec.ts` prints the live project's real `iss` when the e2e suite runs — but **in CI it comes out as `***/auth/v1`**, because GitHub masks the prefix: it is the `SUPABASE_PROJECT_URL` secret. That masking is the answer for this project, then — the issuer is that URL plus `/auth/v1`. Run the suite locally for the unmasked string.

⚠️ **Setting it in production is three places, not one** — SSM parameter, then the IAM execution role, then the task definition, in that order. See `infra/README.md`; `SUPABASE_JWT_SECRET` is the worked example of what happens when only some of them are done.

The guard logs which issuer it requires at startup, so a wrong value is diagnosable there rather than from a wave of 401s.

Other commands:

```bash
npm test                 # unit tests
npm test -- -t "name"    # a single test
npx tsc --noEmit         # typecheck — there is no npm script for this
npm run build            # → dist/
npm run format           # prettier --write
```

⚠️ **`npm run lint` on the backend is `eslint --fix` and rewrites your files.** To check without mutating anything:

```bash
npx eslint "{src,apps,libs,test}/**/*.ts"
```

(The frontend's `npm run lint` is read-only; only the backend's rewrites. `npm run lint:fix` is the mutating one there.)

## 3. Frontend

From `frontend/`:

```bash
npm ci
cp .env.example .env     # then fill it in
npm start                # expo start
```

Then `npm run ios`, `npm run android`, or `npm run web`.

`.env.example` is the template. Three variables are read:

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_API_URL` | where the backend is |
| `EXPO_PUBLIC_SUPABASE_URL` | also used to build the public avatar base URL |
| `EXPO_PUBLIC_SUPABASE_KEY` | the **anon** key, never the service-role one |

One trap worth knowing in advance: **`EXPO_PUBLIC_API_URL` must be a LAN IP, not `localhost`, when running on a physical device** — `localhost` on the phone means the phone. The client throws a named `ApiConfigError` explaining this rather than failing obscurely.

Anything prefixed `EXPO_PUBLIC_` is **inlined into the shipped bundle**. Never put the Supabase service-role key, or any other secret, behind that prefix.

Expo caches env vars aggressively. After editing `.env`, restart Metro with `npx expo start --clear`.

## 4. Check it works

```bash
curl http://localhost:8000/health
```

Should return `{"status":"ok","version":"<git sha>","uptime":…,"timestamp":…}`.

Then sign up in the app. You should land on the create-profile screen — that redirect is driven by `GET /users/me` returning 404, which is the normal state for an auth user with no profile row yet.

## Running the tests

Unit tests need nothing but `npm ci`:

```bash
cd backend && npm test
```

E2E needs the database from step 1 running, plus Supabase credentials, and refuses to run without an explicit opt-in:

```bash
cd backend && E2E_ALLOW_LIVE=1 npm run test:e2e
```

Table rows go to your local Postgres, but **auth users are created on the shared Supabase project**. Its signup limit is per-hour and cumulative, and when tripped it reports "Database error creating new user" — which reads like a broken trigger rather than throttling. If a run dies partway, sweep the leftovers:

```bash
E2E_ALLOW_LIVE=1 npm run e2e:sweep          # respects a 30-minute age guard
E2E_ALLOW_LIVE=1 npm run e2e:sweep -- --all # ignores it
```

## Reproducing CI

`.github/workflows/ci.yml` runs, on Node 20:

- **frontend** — `npm run lint`, `npm run type-check`
- **backend** — `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`
- **backend e2e** — only on PRs to `main` and pushes to `main`, so feature-branch pushes skip it and e2e breakage first surfaces at PR time.

`/ci-check` runs the same gates locally, using the read-only lint form.

## Where to read next

| For | Read |
|---|---|
| How the system fits together | `docs/ARCHITECTURE.md` |
| Who may reach what, per endpoint | `docs/AUTHORIZATION.md` |
| Conventions, per package | `CLAUDE.md`, `frontend/CLAUDE.md`, `backend/CLAUDE.md` |
| Deploying the API to AWS | `infra/README.md` |
