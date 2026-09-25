# LiftOff

A mobile app for the powerlifting community. Two halves: coach↔athlete tooling (coaches send programming and manage a roster; athletes log workouts and message their coach) and a social layer (share lifts, meet recaps, communities, leaderboards).

**Status: pre-release, but further along than it looks.** Built and working: sign up / log in, profile creation and editing, coach↔athlete relationships with invites and notifications, a coach roster, program and workout building, set logging, and messaging with image attachments (polling, not realtime). The social layer (feed, communities, leaderboards) does not exist — no tables, no endpoints, no screens. Assume a feature does not exist until you've read the code.

## Repo shape

Two **independent npm projects** side by side. There is no root `package.json`, no workspaces, no Turborepo/Nx.

```
liftoff-app/
├── frontend/    Expo / React Native app   → see frontend/CLAUDE.md
├── backend/     NestJS REST API           → see backend/CLAUDE.md
├── infra/       AWS deployment runbook   → see infra/README.md
└── .github/workflows/   ci.yml, deploy.yml
```

**`cd frontend` or `cd backend` before any npm command.** Nothing is runnable from the root. CI does this explicitly via `working-directory:`.

Local setup is in `docs/SETUP.md`.

## The data path: everything goes through the API

**Supabase is auth and file storage. All data lives in RDS Postgres behind the NestJS API.** This was not true until recently, and older notes elsewhere may still describe the client reading Supabase tables directly — they are out of date.

- **The client calls the API for everything.** All nine `frontend/lib/api/*` modules (`athlete`, `conversations`, `exercises`, `maxes`, `notifications`, `roster`, `storage`, `users`, `workouts`) go through `frontend/lib/api/client.ts`. The app does not work with the backend stopped.
- **Supabase keeps three jobs:** the identity provider (`signUp` / `signInWithPassword` / `signOut` / `getSession`); the two image buckets (`lib/api/storage.ts`, plus `ChatBubble.tsx` resolving public URLs); and **reference-data reads** — `federations` / `divisions` / `weight_classes` are read straight from Supabase with the anon key, by `lib/reference.ts` (shared, used by `edit-profile.tsx`) and by `create-profile.tsx`'s own older copy. That last one is a real exception to the bullet above. It is public reference data, so nothing user-owned is exposed, but know where it is before reasoning about the trust boundary. Don't extend the pattern to anything user-owned.
- **Auth token flow:** Supabase session JWT → `Authorization: Bearer <token>` → `JwtAuthGuard` (`backend/src/common/validation/guards/auth-guard.ts`, which reads the header and nothing else) → **`JwtVerifier`** (`backend/src/common/validation/jwt-verifier.ts`) → verified **locally** with HS256 when `SUPABASE_JWT_SECRET` is set, falling back to `supabase.auth.getUser(token)` when it is not → `request.user`. Without the secret, every authenticated request is coupled to Supabase's uptime. The verifier is provided by a `@Global()` `JwtModule`, so anything outside the HTTP request path — a socket handshake, a job — verifies through the same code rather than writing a second implementation.
- **Realtime is gone**, replaced by polling — see `frontend/lib/api/polling.ts`.

⚠️ **There is no RLS in RDS. The API is the entire trust boundary.** Nothing in the database will stop a query reading or writing another user's rows, so every query must scope itself — `eq(users.id, user.id)` or a walk up the ownership chain — and the correctness of that is entirely application code. Getting one wrong is a data breach, not a bug. The ownership rules per resource are in `docs/AUTHORIZATION.md`, which cites the enforcing code and the test pinning each one; `backend/src/programming/service/programming-access.ts` is the worked example.

Two rules that fall out of this and are easy to get wrong:

- **Never take an actor id from the request body.** The caller comes from the verified token. `coach_id` on workout creation used to come from the client, which meant any user could attribute a workout to any coach.
- **Prefer 404 over 403** when a caller has no claim on a resource. A 403 confirms the id names something real, which with enumerable ids leaks who is training or talking to whom.

## The database schema

The schema is **in the repo now**, as Drizzle:

- `backend/src/db/schema.ts` — all 19 tables, hand-written rather than `drizzle-kit pull`ed, deliberately dropping the Supabase-isms (`users.id DEFAULT auth.uid()`, the trigger-populated email).
- `backend/src/db/migrations/` — `0000` tables, `0001` the five views as plain SQL (Drizzle does not model views).
- `backend/src/db/seed-reference-data.sql` — federations, divisions, weight classes.

```bash
cd backend && npm run db:up && npm run db:migrate && npm run db:seed && npm run db:verify
```

That gives you a **local Postgres on port 55440** — the local database story this project never had. `schema.ts` is the source of truth; full setup is in `docs/SETUP.md`.

## Conventions differ per package

Guessing wrong here is silent, so check which side you're on:

| | `frontend/` | `backend/` |
|---|---|---|
| Quotes | double | single |
| Imports | `@/...` alias, exclusively | absolute `src/...` (no alias) |
| TS `strict` | **on** | **off** (`noImplicitAny: false`) |
| Prettier | none installed | enforced as an ESLint **error** |
| Tests | none | Jest (unit + e2e) |

## CI gates

From `.github/workflows/ci.yml` — Node 20. These must pass:

- **frontend:** `npm run lint`, `npm run type-check`
- **backend:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`
- **backend e2e:** `npm run test:e2e` — only on PRs to `main` and pushes to `main`

Feature-branch pushes skip e2e, so e2e breakage first surfaces at PR time. Run `/ci-check` to reproduce the gates locally.

⚠️ **A green `backend-e2e` job doesn't mean e2e passed.** The job checks for the `SUPABASE_PROJECT_URL` / `SUPABASE_SECRET_KEY` secrets and skips its remaining steps with a workflow warning if either is missing — without that gate every spec fails identically at `SupabaseService` construction and the job is permanently red. It then probes `$SUPABASE_PROJECT_URL/auth/v1/health` and skips the same way if nothing answers — the secrets stay set when a free-tier project pauses, and the run used to die instead with an opaque `TypeError: fetch failed` in the sweeper. Look for the "E2E skipped" warning before trusting the check.

**Nothing in CI can catch a dead Tailwind class**, which is how the frontend shipped for months with light mode entirely unimplemented. See the verification section in `frontend/CLAUDE.md`.

## Reference

- `docs/ARCHITECTURE.md` — the data path, auth flow, request lifecycle, API surface, known limitations and gaps
- `docs/AUTHORIZATION.md` — who may reach what, per endpoint, with the code and test for each rule
- `docs/SETUP.md` — running both halves locally
- `infra/README.md` — deploying the API to ECS
- `docs/ROADMAP.md` — what is built, the cutline for a team migration, and the open questions
- `docs/AUDIT.md` — findings from the 2026-09-22 feature-by-feature pass, worst first
- `docs/MAXES-DESIGN.md` — derived maxes and percentage prescription: the decisions and why
- `docs/REALTIME-MESSAGING-DESIGN.md` — design only, nothing built
- `docs/archive/` — completed work kept for the traps it records, not current

The schema's source of truth is `backend/src/db/schema.ts`, not prose. The root `README.md` is the product pitch; it points here for everything technical.

## Working norms

- This is a solo student project in active development. Prefer finishing the flow at hand over broad refactors.
- A few known limitations are **documented on purpose** rather than fixed — see "Known limitations" in `docs/ARCHITECTURE.md`. Don't silently change them as a side effect of unrelated work.
- Don't add dependencies without asking. TanStack Query handles server state, `frontend/lib/api/*` is the client layer, and Drizzle is the ORM.
- All API errors share one shape: `{ statusCode, message, timestamp, path, method }`. `message` is an array for validation failures, a string otherwise.
- **`origin/cg_branch` was merged into `main` and is now dead.** It carried six months of feature work that never landed; don't branch from it or cherry-pick out of it.
