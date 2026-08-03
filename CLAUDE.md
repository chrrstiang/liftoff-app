# LiftOff

A mobile app for the powerlifting community. Two halves: coach↔athlete tooling (coaches send programming and manage a roster; athletes log workouts and message their coach) and a social layer (share lifts, meet recaps, communities, leaderboards).

**Status: pre-release, but further along than it looks.** Built and working: sign up / log in, profile creation, coach↔athlete relationships with invites and notifications, a coach roster, program and workout building from templates, set logging, and real-time messaging with image attachments. The social layer (feed, communities, leaderboards) does not exist. The `coaches` module in the backend is still unimplemented Nest scaffolding. Assume a feature does not exist until you've read the code.

## Repo shape

Two **independent npm projects** side by side. There is no root `package.json`, no workspaces, no Turborepo/Nx.

```
liftoff-app/
├── frontend/    Expo / React Native app   → see frontend/CLAUDE.md
├── backend/     NestJS REST API           → see backend/CLAUDE.md
└── .github/workflows/ci.yml
```

**`cd frontend` or `cd backend` before any npm command.** Nothing is runnable from the root. CI does this explicitly via `working-directory:`.

Supabase (hosted Postgres) is the database *and* the auth provider for both halves.

## The data path: the backend is almost bypassed

The most important thing to know, because the file layout actively misleads you: **a NestJS API sits in this repo and the client calls it exactly once.**

- **Everything goes straight to Supabase** with the anon key — reads *and* writes. `frontend/lib/api/*` holds seven modules (`athlete`, `conversations`, `exercises`, `notifications`, `roster`, `storage`, `workouts`) making **13 direct `insert`/`update` calls**. Auth is direct too: `supabase.auth.signInWithPassword` / `signUp` / `signOut`.
- **The one backend call** is an inline `fetch` in `frontend/app/(app)/create-profile.tsx`: `POST /users/profile`. Profile creation is the only flow that breaks if the API is down.
- **Auth token flow (for that one call):** Supabase session JWT → `Authorization: Bearer <token>` → `JwtAuthGuard` (`backend/src/common/validation/guards/auth-guard.ts`) → `supabase.auth.getUser(token)` → `request.user`.

⚠️ **This makes RLS the entire authorization layer for almost the whole app.** Those 13 writes execute with the anon key, so nothing client-side prevents inserting a `coach_athlete` row for someone else's athlete or updating another user's set. Policies in the hosted project are the only control, and since the schema isn't in this repo there's no way to review them from here. Check the Supabase dashboard before trusting any write path.

When adding a feature, decide deliberately which path it takes — and note the two have opposite risk profiles: the direct path is RLS-constrained, while the backend holds a service-role key that bypasses RLS entirely.

## The database schema is not in this repo

There are no migrations, no `.sql` files, and no Supabase CLI directory. The schema exists **only in the hosted Supabase project**, which means:

- There is no way to stand up a local database. Backend e2e tests hit the real remote project.
- `docs/DB-SCHEMA.md` is a **reconstruction from application code**, not a source of truth.
- **Never assume a column exists.** Confirm against `backend/src/users/entities/`, the DTOs, and existing `.select()` calls — or ask.

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

⚠️ **A green `backend-e2e` job doesn't mean e2e passed.** The job checks for the `SUPABASE_PROJECT_URL` / `SUPABASE_SECRET_KEY` secrets and skips its remaining steps with a workflow warning if either is missing — without that gate every spec fails identically at `SupabaseService` construction and the job is permanently red. Look for the "E2E skipped" warning before trusting the check.

**Nothing in CI can catch a dead Tailwind class**, which is how the frontend shipped for months with light mode entirely unimplemented. See the verification section in `frontend/CLAUDE.md`.

## Reference

- `docs/ARCHITECTURE.md` — auth flow, request lifecycle, API surface, known gaps
- `docs/DB-SCHEMA.md` — inferred schema

**Ignore `frontend/README.md` and `backend/README.md`.** Both are unmodified create-expo-app / NestJS boilerplate with no project-specific information — the frontend one still documents a `reset-project` script that has since been removed. The root `README.md` is an accurate product pitch but has no setup instructions.

## Working norms

- This is a solo student project in active development. Prefer finishing the flow at hand over broad refactors.
- A few known limitations are **documented on purpose** rather than fixed — see "Known limitations" in `docs/ARCHITECTURE.md`. Don't silently change them as a side effect of unrelated work.
- Don't add dependencies without asking. TanStack Query handles server state and `frontend/lib/api/*` is the closest thing to a client layer; there is still no ORM.
- All API errors share one shape: `{ statusCode, message, timestamp, path, method }`. `message` is an array for validation failures, a string otherwise.
- **`origin/cg_branch` was merged into `main` and is now dead.** It carried six months of feature work that never landed; don't branch from it or cherry-pick out of it.
