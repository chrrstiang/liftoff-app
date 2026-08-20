# Migration progress

Living status for the move off Supabase Postgres to RDS behind the API. Update it as work lands — it is the handoff between sessions.

**Architecture:** Supabase keeps **auth only**. The 18 tables and 5 views live in RDS, reached exclusively by the NestJS API via Drizzle. Realtime is replaced by polling. Deployed on ECS Express Mode.

## Status at a glance

| Phase | State |
|---|---|
| Week 1 — foundation | ✅ done |
| Week 2 — schema port + AWS | ✅ done |
| Week 2 — endpoint port (3 existing) | ✅ done — **the backend no longer reads data from Supabase** |
| Week 3 — deploy | ✅ done (ahead of schedule) |
| Week 4 — new endpoints | 🔄 coach invites + messaging **merged**; programming + reads left |
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

## `backend-e2e` is red on all three PRs — and it needs you

**Not the auth rate limit.** That was my first diagnosis and it was wrong. Corrected:

`athlete-retrieve`'s `beforeAll` fails on `auth.admin.createUser` with `Database error creating new user`, through four backoff retries, **a full day after the first failure**. An hourly quota does not survive a day.

Meanwhile the same call **succeeds from a laptop** against `hqvnvnuuczqlpffebuui` (`powerlifting-hub`), using `backend/.env`.

Works locally, fails in CI ⇒ **CI is pointed at a different Supabase project.** CI reads the `SUPABASE_PROJECT_URL` / `SUPABASE_SECRET_KEY` repository secrets; the laptop reads `backend/.env`.

There is corroborating evidence: on 2026-08-04, CI's e2e **passed** at a moment when `powerlifting-hub` was paused and its hostname returned NXDOMAIN from every public resolver. It could only have passed by talking to some other project.

**Update: the different-project theory is also wrong.** `SUPABASE_PROJECT_URL` is confirmed as `https://hqvnvnuuczqlpffebuui.supabase.co` — the same project the laptop uses.

Also ruled out: it is not sequence-dependent. Creating three users back to back with CI's exact email pattern succeeds locally every time.

So: same project, same call, same pattern — **works from a laptop, fails from a GitHub runner.** What differs is the network origin and the `SUPABASE_SECRET_KEY` secret's actual value, and neither is visible from here.

**The next step needs the Supabase dashboard.** GoTrue's `Database error creating new user` is a *wrapper* — it deliberately hides the underlying Postgres error. That error is visible in **Supabase → Logs → Auth**, filtered to the time of a failing CI run. One log line will say whether it is the `on_auth_user_created` trigger, a constraint, or throttling. Everything above is inference; that log line is fact.

Worth confirming while there: that `SUPABASE_SECRET_KEY` really is the service-role key. A wrong key normally gives a 401 rather than a database error, so this is unlikely — but it is the one input still unverified.

Everything else on all three PRs is verified. `users.e2e-spec` and `app.e2e-spec` pass; only the auth-user creation in `athlete-retrieve` fails.

## Blocked, and why## Open PRs

| PR | What | State |
|---|---|---|
| **#17** | the endpoint port + giving e2e its own database | verified; `backend-e2e` red on the auth quota below |
| **#18** | coach invites — 4 endpoints, 16 ownership rules verified | off `main`, independent |
| **#19** | messaging incl. `POST /conversations` — 16 rules verified | stacked on #18 |

#18 and #19 were originally piled onto #17, which was wrong: they depend only on `DbModule` and the schema, both already on `main`, so they never needed to sit behind the port. #17's title described just its first commit while it had grown to 27 files. Split out so each is reviewable on its own.

Merge order: **#18 → retarget #19 to `main` → #19**. Do **not** use `--delete-branch` on #18 while #19 is stacked on it — GitHub auto-closes PRs whose base branch disappears, and a closed PR with a missing base cannot be reopened. That already happened once this session.

## Blocked, and why

| Item | Blocker |
|---|---|
| **Frontend flip** | No way to verify. `xcode-select` points at Command Line Tools, `simctl` lists no simulators, so the app cannot be run. The flip is all-or-nothing — once data lives in RDS, every direct-to-Supabase read is dead — so shipping it unverified is not sensible. **Unblocked by installing full Xcode.** |
| **Week-5 feature** | Product decision, not a technical one. |
| **Authorization review** | Not a hard block (no users yet), but with no RLS the API is the entire trust boundary and a wrong ownership check is a breach. Wants human eyes before real signups. |

## Fixed along the way

**A leak this migration introduced.** Moving fixture cleanup to Postgres left nothing sweeping Supabase's side — its `on_auth_user_created` trigger still inserts into *its* `public.users` on every auth user created, and data no longer lives there, so nothing touched those rows. **60 orphans against 0 auth users accumulated within a day.** The sweeper now clears them too, and the existing 60 have been removed.

This disappears entirely once auth stops creating profile rows, but until then it is a real leak in the one database still shared.

## Follow-ups worth doing

- **Commit the integration checks.** The `createUserProfile` assertions above were run by hand against `docker compose` Postgres. CI now has a database, so they can become a committed suite.
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
