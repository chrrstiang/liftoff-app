# LiftOff

A mobile app for the powerlifting community. Two halves: coach↔athlete tooling (coaches send programming and manage a roster; athletes log workouts and message their coach) and a social layer (share lifts, meet recaps, communities, leaderboards).

**Status: pre-release.** Only one flow is actually built end to end — `sign up / log in → complete profile → app shell`. The tab screens (`home`, `program`, `profile`) are placeholder stubs, and the entire coach backend is unimplemented scaffolding. Assume a feature does not exist until you've read the code.

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

## The hybrid data path

The most important thing to know, because nothing in the file layout hints at it: **the client does not go through the API for reads.**

- **Reads → client calls Supabase directly** with the anon key. See the three `useEffect` fetches in `frontend/app/(app)/create-profile.tsx` and `checkProfileCompletion` in `frontend/contexts/AuthContext.tsx:112`.
- **Writes → client `fetch`es the NestJS API.** The *only* backend call in the entire frontend is `frontend/app/(app)/create-profile.tsx:219` (`POST /users/profile`).
- **Auth token flow:** Supabase session JWT → `Authorization: Bearer <token>` header → `JwtAuthGuard` (`backend/src/common/validation/guards/auth-guard.ts`) calls `supabase.auth.getUser(token)` → attaches `request.user`.

So when adding a feature, decide deliberately which path it takes. Note that RLS is the only thing protecting the direct-read path, while the backend holds a service-role key that bypasses RLS entirely.

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

## Reference

- `docs/ARCHITECTURE.md` — auth flow, request lifecycle, API surface, known gaps
- `docs/DB-SCHEMA.md` — inferred schema

**Ignore `frontend/README.md` and `backend/README.md`.** Both are unmodified create-expo-app / NestJS boilerplate with no project-specific information — the frontend one still documents a `reset-project` script that has since been removed. The root `README.md` is an accurate product pitch but has no setup instructions.

## Working norms

- This is a solo student project in active development. Prefer finishing the flow at hand over broad refactors.
- A few known limitations are **documented on purpose** rather than fixed — see "Known limitations" in `docs/ARCHITECTURE.md`. Don't silently change them as a side effect of unrelated work.
- Don't add dependencies without asking. There is deliberately no state library, no API client, and no ORM yet.
- All API errors share one shape: `{ statusCode, message, timestamp, path, method }`. `message` is an array for validation failures, a string otherwise.
