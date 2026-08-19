# Migration progress

Living status for the move off Supabase Postgres to RDS behind the API. Update it as work lands — it is the handoff between sessions.

**Architecture:** Supabase keeps **auth only**. The 18 tables and 5 views live in RDS, reached exclusively by the NestJS API via Drizzle. Realtime is replaced by polling. Deployed on ECS Express Mode.

## Status at a glance

| Phase | State |
|---|---|
| Week 1 — foundation | ✅ done |
| Week 2 — schema port + AWS | ✅ done |
| Week 2 — endpoint port (3 existing) | 🔄 2 of 3 (`?data=` compiler left) |
| Week 3 — deploy | ✅ done (ahead of schedule) |
| Week 4 — new endpoints | ⬜ not started |
| Week 4 — frontend flip | ⛔ blocked (see below) |
| Week 5 — feature | ⛔ blocked (needs a product decision) |

## Live infrastructure

- **API:** `https://li-a0631e9e7c494004855290fbfc225ec6.ecs.us-east-2.on.aws` — HTTPS, ACM certificate managed by Express Mode, no custom domain.
- **RDS:** `liftoff-db`, `db.t4g.micro`, Postgres 15.17, encrypted, not publicly accessible. Master password generated and rotated by RDS into Secrets Manager; the task definition injects it as `PGPASSWORD`, so it exists nowhere else.
- **ECS:** Express Mode service `liftoff-api` on cluster `default`. Container **must** be named `Main`.
- **CI/CD:** `.github/workflows/deploy.yml` deploys on push to `main`. `AWS_DEPLOY_ROLE_ARN` and `API_BASE_URL` are set as repo variables.
- **Cost:** ~$38/mo, mostly the ALB's standing charge.

## Done

- RLS hardened and the schema captured (`docs/DB-SCHEMA.md` is now generated, not inferred).
- e2e fixtures namespaced and sweepable; the service-role client is no longer poisoned by `signUp`.
- Frontend API client (`lib/api/client.ts`) and per-resource types.
- Three dead cache updates and a broken search filter fixed.
- `GET /health` + multi-stage Dockerfile.
- Drizzle schema for all 18 tables, 5 views as migration `0001`, reference-data seed, and `verify-port.sql` (18 assertions).
- Local Postgres via `docker compose` — the local database story this project never had.
- Full AWS infrastructure, live and serving.
- **`UsersService` on Drizzle with a real transaction.** `POST`/`PATCH /users/profile` now insert rather than update, taking id and email from the verified JWT — the API has taken over the job the Supabase trigger used to do. Both DB-backed validators and `AthleteExistsGuard` are ported too.

### Verified against real Postgres

`createUserProfile` was checked end to end on the local database, not just with mocks:

| | |
|---|---|
| API creates the `users` row | ✅ (the trigger is gone) |
| email comes from the verified token | ✅ |
| athlete + coach rows in one write | ✅ |
| **duplicate username → full rollback, no `users` row** | ✅ |
| **→ no orphaned `athletes` row** | ✅ |
| validation short-circuits before any write | ✅ |
| `updateProfile` touches only the caller | ✅ |

The two rollback rows are the ones that matter: under the old compensating-delete scheme that was exactly the window that could leave a half-created profile behind.

## Blocked, and why

| Item | Blocker |
|---|---|
| **Frontend flip** | No way to verify. `xcode-select` points at Command Line Tools, `simctl` lists no simulators, so the app cannot be run. The flip is all-or-nothing — once data lives in RDS, every direct-to-Supabase read is dead — so shipping it unverified is not sensible. **Unblocked by installing full Xcode.** |
| **Week-5 feature** | Product decision, not a technical one. |
| **Authorization review** | Not a hard block (no users yet), but with no RLS the API is the entire trust boundary and a wrong ownership check is a breach. Wants human eyes before real signups. |

## Follow-ups worth doing

- **Integration tests in CI.** The `createUserProfile` checks above were run by hand against `docker compose` Postgres. They should be a committed suite — now genuinely possible, and hermetic, for the first time.
- **`AthleteService` (`?data=`)** is the last Supabase data reader. Its allowlist compiler builds a PostgREST select string, so porting it means rethinking the mechanism, not translating it.
- **`JwtAuthGuard` → local JWKS.** Still a network round trip to Supabase on every request.

## Ownership rules for the new endpoints

With RLS gone, these are application code and are the actual deliverable of each slice.

| Resource | Rule |
|---|---|
| `coach_requests` | a coach may only create an invite naming themselves; only the named athlete may accept or decline |
| `coach_athlete_relationships` | derived server-side from a stored **accepted** request, never from client input |
| `conversations` / `conversation_members` | `POST /conversations` owns creation; membership is never client-supplied |
| `messages` | caller must be a member of the conversation |
| `workouts` | coach owns it; assigning to an athlete requires an active relationship |
| `sets` | walk `sets → workout_exercises → workouts → athlete_id | coach_id` |
| `exercises` / `exercise_templates` | `created_by` must be the caller, and the caller must be a coach |

## Notes worth keeping

- `users.id` no longer defaults to `auth.uid()`, and the Supabase trigger that created `public.users` rows at signup does not come with us. **The API owns profile-row creation on first login.**
- `JwtAuthGuard` still calls Supabase Auth on every request. Once auth is the only remote hop, swap it for local JWKS verification.
- `is_template` has no default, which is why the template list is always empty. Decide the semantics when writing `POST /workouts`.
- `user_conversations_view` emits one row per (conversation, member); callers must filter by `user_id`.
