# LiftOff — Architecture

Longer-form reference for the flows that span both packages. For day-to-day conventions see `CLAUDE.md`, `frontend/CLAUDE.md`, and `backend/CLAUDE.md`. For who may reach what, per endpoint, see `docs/AUTHORIZATION.md` — it is the authoritative map and cites the code enforcing each rule.

Rewritten 2026-09-13 against the code. The previous revision predated the RDS migration and described a system that no longer existed.

---

## 1. Where the data lives

The single most important thing to have right, because an older generation of notes had it backwards.

**All application data is in RDS Postgres, reached exclusively by the NestJS API through Drizzle.** The client never touches a data table.

**Supabase keeps three jobs**, and only three:

| Job | Where |
|---|---|
| Identity provider — `signUp` / `signInWithPassword` / `signOut` / `getSession` | `frontend/contexts/AuthContext.tsx` |
| Two image buckets — `avatars`, `conversations` | `frontend/lib/api/storage.ts`, `frontend/components/ChatBubble.tsx` |
| Reference-data reads on one screen | `frontend/app/(app)/create-profile.tsx` |

That third one is a real exception, not an oversight to paper over. `create-profile.tsx` reads `federations`, `divisions` and `weight_classes` **directly from Supabase with the anon key** in three chained effects. Those tables are public reference data — three federations, sixteen divisions, the weight classes — so nothing user-owned is exposed. But it means "the client calls the API for everything" is not literally true, and anyone reasoning about the trust boundary should know where the exception is.

**Realtime is gone.** It was dropped with the migration and replaced by HTTP polling — `frontend/lib/api/polling.ts`, 5s in an open thread, 30s on the inbox. That file names its own replacement: a websocket or SSE endpoint, not a shorter interval. `docs/REALTIME-MESSAGING-DESIGN.md` is the design for that, unbuilt.

⚠️ **There is no RLS in RDS. The API is the entire trust boundary.** Nothing in the database will stop a query reading or writing another user's rows. Every query must scope itself, and the correctness of that is entirely application code.

---

## 2. Auth → profile completion → app access

Three cooperating pieces: Supabase Auth, `frontend/contexts/AuthContext.tsx`, and the redirect gate in `frontend/app/_layout.tsx`.

### Entry points

**Email + password only** — `supabase.auth.signUp()` / `signInWithPassword()`. There is no magic link, no OAuth, no password reset. (`expo-auth-session` and `expo-web-browser` are installed but unused.)

**Session restore** — `supabase.auth.onAuthStateChange` keeps `session` and `isAuthenticated` in sync. The client uses `autoRefreshToken: true` with AsyncStorage persistence, so sessions survive app restarts.

> ⚠️ **Never `await` a Supabase auth method inside `onAuthStateChange`.** The callback runs while the client holds its own lock, so calling `getSession()` from within it deadlocks. This locked out every returning user — the first launch worked, every launch after it hung on the splash screen — and lint and type-check cannot see it. Defer to a macrotask.

### Profile completion

A Supabase auth user is *not* enough to enter the app; a `users` row must exist too. `AuthContext` calls **`GET /users/me`**, and the API computes `is_profile_complete` server-side from `first_name`, `last_name`, `username`, `gender`, `date_of_birth`.

**A 404 from `GET /users/me` is a normal state, not an error.** Between signing up and finishing the form there is no `users` row at all — the Supabase trigger that used to create one does not exist in RDS — and that 404 is precisely the signal the gate reads as "send them to create-profile." Anything else is treated as a transient failure and deliberately leaves `isProfileComplete` untouched, so a dropped connection can no longer bounce a signed-in user to the create-profile screen mid-session.

### The gate

An effect keyed on `useSegments()` in `frontend/app/_layout.tsx`, behind an `isReady` memo:

| Condition | Redirect |
|---|---|
| `!isAuthenticated` and not in `(auth)` | `/(auth)/login` |
| `isAuthenticated` and `!isProfileComplete` | `/(app)/create-profile` |
| authenticated, complete, still on create-profile | `/(app)/(tabs)/home` |

Until `isReady`, the layout renders a themed `AuthLoadingScreen` and skips the effect, which is what prevents a flash of the login screen on cold start.

**Any new top-level route group must be handled here** or it will be redirected away the moment it mounts.

### Profile submission

`create-profile.tsx` gathers general info plus role-specific fields and `POST`s to `/users/profile`. The API takes the id and email from the **verified token**, never the body, and writes `users` + `athletes` + `coaches` in one transaction.

---

## 3. Request lifecycle (backend)

```
client fetch (lib/api/client.ts attaches the bearer token)
  → JwtAuthGuard          verifies the JWT locally (HS256) when SUPABASE_JWT_SECRET is set,
                          else falls back to supabase.auth.getUser(token);
                          attaches request.user  (401 on missing/invalid)
  → AthleteExistsGuard    (athlete profile route only) 400 if no :id, 404 if no athletes row
  → ValidationPipe        whitelist + forbidNonWhitelisted + transform;
                          runs class-validator DTOs, including DB-backed async validators
  → Controller            thin: reads req.user, delegates, returns { message }
  → Service               @Inject(DRIZZLE) → Drizzle query, scoped to req.user
  → RDS Postgres          no RLS — the scoping above is the only authorization
  → GlobalExceptionFilter { statusCode, message, timestamp, path, method }
```

Local JWT verification matters for availability as much as latency: without it every authenticated request is coupled to Supabase's uptime. The project's JWKS endpoint returns `{"keys":[]}`, so the tokens are symmetric and node's `crypto` is enough — no new dependency. If `SUPABASE_JWT_SECRET` is unset in a deployed task, the guard silently reverts to the remote call.

Every error leaves through `GlobalExceptionFilter`, registered in `src/main.ts`. It reads `exception.getResponse()` rather than `exception.message`, which matters: for a `ValidationPipe` failure `exception.message` is only `"Bad Request Exception"`, so reading it would discard the per-field detail. As a result `message` is an **array** of field messages for validation errors and a **string** for manually thrown exceptions. Anything that isn't an `HttpException` is logged server-side and masked as a generic 500.

`validationExceptionFactory` (+ `exception-mappings.ts`) is implemented but **deliberately not registered**: it inspects only `errors[0]`, so it would collapse a six-field validation failure into a single message. Enabling it is a product decision about error verbosity, not a fix.

---

## 4. The sparse-fieldset `?data=` compiler

`GET /athlete/profile/:id?data=a,b,c` compiles a caller-supplied field list into a **Drizzle selection**, assembled from explicit column maps in `backend/src/users/service/athlete/athlete.service.ts` (`ATHLETE_COLUMNS`, `RELATED_COLUMNS`). Three allowlists in `backend/src/common/types/select.queries.ts` govern what is reachable:

| Query form | Example | Allowlist |
|---|---|---|
| direct column | `federation_id` | `VALID_ATHLETES_COLUMNS_QUERIES` |
| nested field | `users.username` | `VALID_TABLE_FIELDS` |
| full table | `federations` | `VALID_FULL_TABLE_QUERIES` |

Anything off-allowlist is a `BadRequestException`. `PUBLIC_PROFILE_QUERY` is the default when no `data` is given, and must only reference columns that are definitely populated, since it cannot be allowed to fail.

⚠️ **These allowlists are a security boundary.** They are the only thing constraining what this endpoint returns about another user. `VALID_TABLE_FIELDS.users` is exactly four columns — `first_name`, `last_name`, `username`, `gender`. `email` is excluded because it is NOT NULL and is another user's PII on what is otherwise a public profile endpoint; `role` was excluded because it is not a column at all.

`select.queries.spec.ts` pins all three allowlists **by their contents** and is designed to fail when one is widened — that failure is the review prompt, not something to make pass. It exists because the six e2e rejection tests all named fields that were *already* absent, so they could not have noticed a field being added.

**Athlete profiles are intentionally public to any authenticated caller.** That is a decision, recorded here so it is not mistaken for a gap.

---

## 5. The dual-role data model

`is_athlete` and `is_coach` are independent booleans on `users`. A user can be both, and the UI supports it — the profile screen renders "Athlete & Coach", and tabs are role-gated with `Tabs.Protected`. Role-specific data lives in satellite tables keyed by the same id:

- `athletes` — `federation_id`, `division_id`, `weight_class_id`, `team_id`
- `coaches` — `biography`, `years_of_experience`

So `users.id == athletes.id == coaches.id` for a given person.

### `createUserProfile` is a real transaction

`backend/src/users/service/users.service.ts` runs `db.transaction(async (tx) => ...)` across `users`, `athletes` and `coaches`. A failure anywhere rolls everything back — verified against real Postgres, including that a duplicate username leaves no `users` row *and* no orphaned `athletes` row.

Two things worth knowing:

1. **Cross-field validation runs before the transaction opens.** Those are reads, and a clean 400 beats an aborted transaction.
2. **It INSERTs the `users` row, it does not update it.** On Supabase a trigger on `auth.users` created `public.users` at signup and copied the email. That trigger does not come with us, and there is no foreign key between the two databases, so **the API owns profile-row creation on first login.**

The previous implementation hand-rolled compensating deletes, tracking `insertedTables` and reversing them on failure. That existed only because supabase-js has no transaction API. Do not reintroduce it.

---

## 6. API surface

Every route except `GET /` and `GET /health` carries a per-route `@UseGuards(JwtAuthGuard)`.

| Resource | Endpoints |
|---|---|
| health | `GET /`, `GET /health` (unguarded; `/health` reports the built `GIT_SHA`) |
| users | `GET /users/me`, `POST /users/profile`, `PATCH /users/profile` |
| athletes | `GET /athlete/profile/:id`, `GET /athlete/search?q=` |
| coaching | `GET`/`POST /coach-requests`, `PATCH /coach-requests/:id`, `GET /coach-requests/roster` |
| messaging | `GET`/`POST /conversations`, `GET`/`POST /conversations/:id/messages`, `POST /conversations/:id/read` |
| workouts | `GET /workouts?athlete_id=`, `GET /workouts/templates`, `GET /workouts/history?athlete_id=`, `GET /workouts/:id`, `POST /workouts`, `POST /workouts/:id/exercises`, `DELETE /workouts/:id` |
| sets | `PATCH /sets/:id` |
| exercises | `GET`/`POST /exercises`, `GET /exercises/templates`, `GET /exercises/:id/history?athlete_id=` |

The two `history` routes are the only paginated reads in the API: `?before=` is an
exclusive `YYYY-MM-DD` bound the client fills with its **local** today, `?limit=`
caps at 50, and the response is an envelope carrying `has_more` rather than a bare
array. Everything else returns the whole list.

All seven `frontend/lib/api/*` resource modules have endpoints to call, and the app does not function with the backend stopped.

### Two rules that shape every endpoint

- **Never take an actor id from the request body.** The caller comes from the verified token. `coach_id` on workout creation used to come from the client, which meant any user could attribute a workout to any coach; sending it is now a 400. Same for `sender_id` on a message.
- **Prefer 404 over 403** when a caller has no claim on a resource. A 403 confirms the id names something real, which with enumerable ids leaks who is training or talking to whom. 403 is reserved for callers who can already see the resource but may not perform the action — a coach cannot log their athlete's set, because a coach who could would be able to falsify what the athlete actually lifted.

---

## 7. Known limitations

Deliberate, or unverified — not defects to fix on sight.

1. **`validationExceptionFactory` is unregistered by choice.** See §3. Its mappings also reference properties no DTO has (`email`, `password`, `age`, `phone`) and state a 3–20 username length where the DTO says 3–30.
2. **`athletes.team_id` is never written.** The `teams` table exists with exactly two columns (`id`, `created_at`) and no rows; it is carried only because `athletes.team_id` references it. Team features are unbuilt.
3. **The five database views are unused.** Migration `0001` creates them, but no backend code queries any of them — the joins were rewritten in Drizzle (`coach-requests.service.ts` replaces `coach_athletes_view`, `conversations.service.ts` replaces `user_conversations_view`, `athlete.service.ts` replaces `user_profiles_enriched_view`). They are kept in the migration chain for parity, not because anything reads them.
4. **`PATCH /athlete/profile` was specced but never built.** `UpdateAthleteDto` captures the intended request shape — name-based `federation` / `division` / `weight_class` rather than IDs, which would need resolving and cross-validating against gender and federation. It is the design record for whoever builds it.
5. **`@IsUnique('users','username')` matches the caller's own row**, so re-sending your current username on `PATCH /users/profile` is rejected as a collision with yourself. Nothing hits this today because the client only sends changed fields, but a settings screen that PATCHed the whole form would. Pinned as a known rough edge in `users.e2e-spec.ts`.
6. **The `supabase/` directory is vestigial.** It still holds `config.toml`, one migration, and `tests/rls_regression.sql` that no workflow runs. Harmless, but it describes a database the app no longer reads from.
7. **`DIRECT_USER_REFERENCES` in `test/helpers/fixtures.ts` is dead.** The real cleanup list is the `statements` array below it. A dead const that looks authoritative is worse than none.

### Bugs, confirmed but not yet fixed

- **Gender "Other" fails profile creation.** `create-profile.tsx` offers chips `["Male", "Female", "Other"]`, but `CreateUserDto` and the Postgres enum are `Male | Female | Gender-fluid`. Selecting "Other" returns a 400 on submit.
- **Both template pickers are empty on a fresh database.** Nothing inserts into `exercise_templates` — no endpoint, no UI — and a workout template requires `athlete_id: null`, which no UI path produces, since the program screen always passes a concrete athlete id. `GET /workouts/templates` and `GET /exercises/templates` are correct and tested; they have no producers.
- **`DELETE /workouts/:id` has no caller.** Built, guarded, tested, unreachable from the app.
- **`onCreateWorkout` arity mismatch** in `program/[athleteId].tsx` — the child calls it with four arguments, the parent handler declares three.

---

## 8. Known gaps

Not bugs — just not built.

- **The entire social layer.** No feed, posts, meet recaps, PR showcase, lift sharing, communities, leaderboards, or following. No tables, no endpoints, no screens, no types. This is half the product pitch and none of the code.
- **No frontend tests**, and no formatter on that side. CI covers lint + type-check only, and neither can see a dead Tailwind class or a wrong colour.
- **No automated check for a cold start with a restored session** — the exact shape of the deadlock in §2. Until something covers it, open the app twice by hand before releasing.
- **No group conversations.** `conversations.name` and `avatar_url` exist, but `POST /conversations` takes a single `participant_id` and creates a 1:1 thread.
- **No video or file messages.** The `message_type` enum includes `'video'` and `'file'`; only `'text'` and `'image'` are produced or rendered.
- **No push or email notifications**, and no roster-wide announcements. In-app notifications are pending coach invites only.
- **No coach discovery** — athletes cannot search for or request a coach; invitations are coach-initiated. There is also no way to remove an athlete from a roster or cancel a sent invite.
- **No profile editing beyond the avatar.** `PATCH /users/profile` works, but the only field the UI sends is `avatar_url`.
- **No week/block/mesocycle model.** "Week 1" on the program screen is a hardcoded label.
- **No password reset, email verification, account deletion, or OAuth.**
- **Leftover test data in production.** Four `liftoff-verify-*` auth accounts and their RDS rows from the 2026-08-31 verification run, plus one stray `users` row. Consistent across both databases, so delete them together or not at all — removing the auth half alone would manufacture the orphan problem the e2e sweeper exists to prevent.

---

## 9. Testing

| Suite | Command | Scope |
|---|---|---|
| backend unit | `npm test` | 9 spec files, mocked Drizzle |
| backend e2e | `E2E_ALLOW_LIVE=1 npm run test:e2e` | 5 spec files against real Postgres; Supabase for auth users only |

**Unit specs mock the Drizzle client, so they cannot distinguish valid SQL from invalid.** The port shipped two bugs of exactly that shape — an `undefined` interpolated into a `where`, and a malformed uuid surfacing as a 500 instead of a 400. Both passed their mocked specs. So each slice wants both layers: the rules proven cheaply in the unit spec, the queries proven in e2e.

`src/db/testing/db-mock.ts` is the shared double. It routes results **by table, not by call order** — a flat queue makes every spec depend on the exact query sequence, so adding one validation read silently shifts every later result onto the wrong statement.

⚠️ **A green `backend-e2e` job in CI does not mean e2e passed.** It skips with a workflow warning if the Supabase secrets are absent or the project is paused. Look for the "E2E skipped" warning — or better, for a `Tests:` line — before trusting it.
