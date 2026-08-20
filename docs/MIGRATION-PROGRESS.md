# Migration progress

Living status for the move off Supabase Postgres to RDS behind the API. Update it as work lands — it is the handoff between sessions.

**Architecture:** Supabase keeps **auth only**. The 18 tables and 5 views live in RDS, reached exclusively by the NestJS API via Drizzle. Realtime is replaced by polling. Deployed on ECS Express Mode.

## Status at a glance

| Phase | State |
|---|---|
| Week 1 — foundation | ✅ done |
| Week 2 — schema port + AWS | ✅ done |
| Week 2 — endpoint port (3 existing) | ✅ merged |
| Week 3 — deploy | ✅ done — pipeline deploys on push to `main` and verifies the rollout |
| Week 4 — new endpoints | ✅ **all built.** coach invites + messaging merged; programming open as a PR |
| Week 4 — frontend flip | 🔄 unblocked — Xcode installed, and the endpoints it needs now exist |
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
- **`AthleteService` ported.** The `?data=` compiler built a PostgREST select string; it now builds a Drizzle selection and reassembles the same nested response shape, so the API contract is unchanged. The allowlists are untouched — they are still the only thing constraining what the endpoint returns.
- **e2e is now hermetic for data.** CI runs a Postgres service container, migrates, seeds and runs `verify-port.sql` before the suite. Only auth users still touch the shared Supabase project, because that is where auth genuinely lives.

**The backend is off Supabase for data.** The only remaining consumer is `JwtAuthGuard`, which is correct — that is auth.

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

## All PRs merged

`main` now carries the endpoint port, coach invites, messaging, and a deploy pipeline that verifies its own rollout. Nothing is open.

**The e2e failure is resolved.** It was never the auth rate limit (my first guess) or a different project (my second) or a duplicate email (my third). The cause was **60 orphaned rows in Supabase's `public.users`** — its `on_auth_user_created` trigger still writes there, and when fixture cleanup moved to Postgres, nothing swept them. Clearing them turned e2e green on the same commit; the sweeper now prevents recurrence.

I do not know the precise mechanism by which orphans broke the trigger, and I am not going to claim one. The empirical result stands.

**The deploy lied once before it worked.** The first run reported success while leaving the old container serving, because it polled `service.status.statusCode` — which is `ACTIVE` before, during and after a rollout. It now polls the active task definition ARN, and the smoke test hits a route only new code has. Both are in the runbook's failure table.

## Open PR

**Programming endpoints** — `programming-endpoints`. Workouts, sets and the exercise library, plus `GET /athlete/search`. This is the last endpoint slice; with it the API covers everything the seven `lib/api/*` modules do.

Three latent bugs fixed inside it, all of which had been shipping:

- **`is_template` was never written**, so it was NULL, and `.eq('is_template', true)` does not match NULL. The template list has been empty for everyone since the feature shipped. Now derived — a workout is a template exactly when it has no athlete — which also makes `is_template=true` *with* an `athlete_id` unrepresentable.
- **Athlete search excluded nobody.** It compared `user.id` against the already-invited set, but the view's identity column is `athlete_id` and there is no `id`, so it tested `undefined` every time.
- **The search term was interpolated into a PostgREST `.or()` expression.** Now a parameterised `ilike` with `%` and `_` escaped; a bare `%` previously matched every athlete in the database.

`coach_id` is also gone from the create body — it used to come from the client, so any user could attribute a workout to any coach.

## Blocked, and why

| Item | Blocker |
|---|---|
| **Week-5 feature** | Product decision, not a technical one. Recommendation: finish the coach↔athlete loop (conversation-creation UI, template list) rather than start something new. |
| **Authorization review** | Not a hard block (no users yet), but with no RLS the API is the entire trust boundary and a wrong ownership check is a breach. Wants human eyes before real signups. |

**No longer blocked:** the frontend flip. Xcode and the iPhone 17 simulators are installed, and the endpoints it needs to target now exist.

## Fixed along the way

**A leak this migration introduced.** Moving fixture cleanup to Postgres left nothing sweeping Supabase's side — its `on_auth_user_created` trigger still inserts into *its* `public.users` on every auth user created, and data no longer lives there, so nothing touched those rows. **60 orphans against 0 auth users accumulated within a day.** The sweeper now clears them too, and the existing 60 have been removed.

This disappears entirely once auth stops creating profile rows, but until then it is a real leak in the one database still shared.

## ~~RDS has no schema yet~~ — DONE

Applied 2026-08-20 via a one-off Fargate task in the VPC: **18 tables, 5 views, 3 federations**. Procedure is in `infra/README.md` under "Applying migrations to RDS", and the tooling is committed (`backend/Dockerfile.migrate`, `src/db/migrate.ts`, `infra/ecs/migrate-task-definition.json`).

### End-to-end verified against the live API

| | |
|---|---|
| Supabase issues a token | ✅ auth still lives there |
| unauthenticated request → 401 | ✅ |
| `POST /users/profile` → 201 | ✅ writes to RDS |
| `GET /coach-requests` → 200 | ✅ reads RDS |
| `GET /coach-requests/roster` → 200 | ✅ |
| `GET /conversations` → 200 | ✅ |
| profile **not** written to Supabase | ✅ only the trigger's own row |

**The split works.** Supabase for auth, RDS for data, through the deployed service.

One leftover: a single test `users` row in RDS (`0e599b99-5170-4991-b2c6-41d8f14c979d`). Harmless in an otherwise empty database; RDS is not reachable from a laptop, and spinning a Fargate task to delete one row is not worth it.


## Follow-ups worth doing

- **Commit the integration checks.** The `createUserProfile` assertions above were run by hand against `docker compose` Postgres. CI now has a database, so they can become a committed suite. The programming slice does this properly — `test/programming/programming.e2e-spec.ts` is committed and runs in CI.
- **`JwtAuthGuard` → local JWKS.** Still a network round trip to Supabase on every request.
- **Coach invites and messaging have no committed tests.** Their 32 ownership rules were verified by hand against the live API and were never turned into specs, unlike programming's. That verification is not repeatable and does not run in CI.
- **`DIRECT_USER_REFERENCES` in `test/helpers/fixtures.ts` is dead.** The real cleanup list is the `statements` array below it. A dead const that looks authoritative is worse than none — someone will add a table to it and assume it took effect.

## Testing the endpoints: what proves what

Worth being explicit, because it has already cost debugging time. Unit specs mock the Drizzle client, so **they cannot distinguish valid SQL from invalid**. The earlier port shipped two bugs of exactly that shape: an `undefined` interpolated into a `where` (producing `where "username" =  limit $1`), and a malformed uuid surfacing as a 500 instead of a 400. Both passed their mocked specs.

So each slice wants both:

| Layer | Proves | Cannot prove |
|---|---|---|
| unit spec, mocked db | the rule rejects; a rejected write issues no INSERT | the SQL runs; a transaction rolls back |
| e2e against real Postgres | queries execute, joins produce the expected shape, status codes are right | — |

`src/db/testing/db-mock.ts` is the shared double. It routes results **by table, not by call order** — a flat queue makes every spec depend on the exact sequence of queries, so adding one validation read silently shifts every later result onto the wrong statement and the failure surfaces somewhere unrelated. It is excluded from `tsconfig.build.json`, so it cannot reach the image.

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
- ~~`is_template` has no default, which is why the template list is always empty.~~ **Decided:** a workout is a template exactly when `athlete_id is null`, and `POST /workouts` writes the column rather than accepting it. `listTemplates` also filters on `athlete_id is null` so rows predating the fix still appear.
- `user_conversations_view` emits one row per (conversation, member); callers must filter by `user_id`.
