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

`.env.example` lists what is needed. The two that will stop you dead: `SUPABASE_PROJECT_URL` and `SUPABASE_SECRET_KEY` (the **service-role** key) — `SupabaseService` throws at construction if either is missing, so the app will not boot without them. That is deliberate: a fast, obvious failure.

Also worth setting `SUPABASE_JWT_SECRET`. With it, `JwtAuthGuard` verifies tokens locally with HMAC; without it, every authenticated request falls back to a network call to Supabase.

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

`.env.example` lists the variables. One trap worth knowing in advance: **`EXPO_PUBLIC_API_URL` must be a LAN IP, not `localhost`, when running on a physical device** — `localhost` on the phone means the phone. The client throws a named `ApiConfigError` explaining this rather than failing obscurely.

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
