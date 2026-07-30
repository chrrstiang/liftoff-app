# LiftOff — Architecture

Longer-form reference for the flows that span both packages. For day-to-day conventions see `CLAUDE.md`, `frontend/CLAUDE.md`, and `backend/CLAUDE.md`.

---

## 1. Auth → profile completion → app access

The only fully implemented flow in the app. Three cooperating pieces: Supabase Auth, `frontend/contexts/AuthContext.tsx`, and the redirect gate in `frontend/app/_layout.tsx`.

### Entry points

**Password signup / login** — `supabase.auth.signUp()` / `signInWithPassword()`. On success `login` sets `isAuthenticated` directly.

**Magic link** — `sendMagicLink(email)` calls `signInWithOtp` with `shouldCreateUser: true` and `emailRedirectTo: makeRedirectUri()`. The user returns via a deep link carrying `access_token` and `refresh_token` in the query string, which `handleDeepLink` extracts with `QueryParams.getQueryParams` and feeds to `supabase.auth.setSession()`.

> A module-level `lastProcessedUrl` variable guards against processing the same deep-link URL twice. It lives outside the component on purpose — it must survive re-renders. If you refactor `AuthContext`, preserve this or magic-link sign-in will double-fire.

**Session restore / expiry** — `checkAuthState()` runs on mount, and `supabase.auth.onAuthStateChange` keeps `session` and `isAuthenticated` in sync afterward. The client is configured with `autoRefreshToken: true` and AsyncStorage persistence, so sessions survive app restarts.

### Profile completion

Supabase Auth creating a user is *not* enough to enter the app. A `users` row must also be filled in. Whenever `session.user` changes, `checkProfileCompletion(userId)` reads five columns directly from Supabase:

```
first_name, last_name, username, gender, date_of_birth
```

All five non-null → `isProfileComplete = true`. Any missing → false. Note this function signals incompleteness by `throw`ing internally and catching its own error, so a *network* failure and a *genuinely incomplete* profile are indistinguishable to the caller — both land the user on the create-profile screen.

### The gate

One `useEffect` keyed on `useSegments()` in `frontend/app/_layout.tsx:22`:

| Condition | Redirect |
|---|---|
| `!isAuthenticated` and not in `(auth)` | `/(auth)/login` |
| `isAuthenticated` and `!isProfileComplete` | `/(app)/create-profile` |
| authenticated, complete, still on create-profile | `/(app)/(tabs)/home` |

While `isLoading`, the layout renders a bare `<ActivityIndicator />` and skips the effect entirely — which is what prevents a flash of the login screen on cold start.

**Any new top-level route group must be handled here** or it will be redirected away.

### Profile submission

`create-profile.tsx` is the only screen that writes through the API. It gathers general info plus role-specific fields, then `POST`s the whole payload to `/users/profile` with the Supabase access token as a bearer. On success it re-runs `checkProfileCompletion` — which flips the gate — and replaces the route with `/(app)/(tabs)/home`.

Its dropdown options (`federations`, then `divisions` and `weight_classes` filtered by the selected federation) are read **straight from Supabase** in three chained `useEffect`s, not from the API.

---

## 2. Request lifecycle (backend)

```
client fetch
  → JwtAuthGuard          extracts "Bearer <token>", supabase.auth.getUser(token),
                          attaches request.user  (401 on missing/invalid)
  → AthleteExistsGuard    (athlete routes only) 400 if no :id, 404 if no athletes row
  → ValidationPipe        whitelist + forbidNonWhitelisted + transform;
                          runs class-validator DTOs, including DB-backed async validators
  → Controller            thin: reads req.user, delegates, returns { message }
  → Service               supabaseService.getClient() → query builder;
                          errors funnel through handleSupabaseError
  → Supabase (Postgres)   service-role key — RLS is bypassed
  → GlobalExceptionFilter { statusCode, message, timestamp, path, method }
```

Every error leaves through `GlobalExceptionFilter`, registered in `src/main.ts`. It reads `exception.getResponse()` rather than `exception.message`, which matters: for a `ValidationPipe` failure `exception.message` is only `"Bad Request Exception"`, so reading it would discard the per-field detail. As a result `message` is an **array** of field messages for validation errors and a **string** for manually thrown exceptions. Anything that isn't an `HttpException` is logged server-side and masked as a generic 500.

`validationExceptionFactory` (+ `exception-mappings.ts`) is implemented but **deliberately not registered**: it inspects only `errors[0]`, so it would collapse a six-field validation failure into a single message. Enabling it is a product decision about error verbosity, not a fix.

Because the service-role key bypasses RLS, **authorization is entirely an application-code concern.** `JwtAuthGuard` establishes *who* the caller is; nothing automatic constrains *what rows* they can touch. Every query must scope itself explicitly.

---

## 3. The sparse-fieldset query compiler

`GET /athlete/profile/:id?data=a,b,c` lets callers request exactly the fields they want. `AthleteService.retrieveProfileDetails` → `cleanDataArray` → `constructSelectQuery` turns that list into a Supabase select string, validating every entry against allowlists in `backend/src/common/types/select.queries.ts`.

Three accepted forms:

| Form | Example | Compiles to | Validated against |
|---|---|---|---|
| direct column on `athletes` | `federation_id` | `federation_id` | `VALID_ATHLETES_COLUMNS_QUERIES` |
| nested field on a relation | `users.username` | `users (username)` | `VALID_TABLE_FIELDS` |
| whole relation | `federations` | `federations (*)` | `VALID_FULL_TABLE_QUERIES` |

`cleanDataArray` dedupes and drops nested fields already covered by a requested full table. Anything off-allowlist throws `BadRequestException`. With no `data` param, `PUBLIC_PROFILE_QUERY` is used.

**Treat the allowlists as a security boundary.** Two exclusions are deliberate, and the source says so:

- `user_id` is excluded from the athlete columns because it maps to `auth.uid()`.
- `users` is capped at five columns (`name`, `username`, `email`, `role`, `gender`).

Widening either to make a query convenient re-opens whatever this was closing.

---

## 4. Dual-role data model

A single `users` row can be **both** athlete and coach — the `is_athlete` / `is_coach` booleans are independent, and the profile form lets you select both.

`UsersService.createUserProfile` therefore:

1. **Validates first, writes nothing.** If `is_athlete`:
   - `division_id` must belong to the given `federation_id`
   - `weight_class_id` must match both `federation_id` **and** `gender`
   - either check without a `federation_id` is a 400
2. Inserts a `coaches` row if `is_coach`, then an `athletes` row if `is_athlete`, recording each success.
3. Updates the `users` row with the general fields.
4. If step 2 or 3 fails, deletes the rows recorded in step 2, in reverse order.

These are **application-level** foreign-key checks — there's no guarantee the database enforces the same, so keep them when touching this path.

**On atomicity:** the Supabase client offers no transaction, so this is validate-early plus compensating deletes, not a real rollback. Validation moved ahead of the writes because that's where the realistic failures live (a bad division used to insert a coach row before it was ever checked). The compensation covers the rest — constraint violations, dropped connections — on a best-effort basis: a failed delete is logged, never thrown, so the original error still surfaces. A genuine transaction would mean moving this into a Postgres function and calling it via RPC, which is the right move if this flow grows.

See `docs/DB-SCHEMA.md` for tables and columns.

---

## 5. API surface

No global prefix, no versioning. Route prefixes come from `@Controller(...)`.

| Route | Guards | Status |
|---|---|---|
| `GET /` | — | hello-world scaffold |
| `POST /users/profile` | `JwtAuthGuard` | **implemented** — 201, creates profile |
| `PATCH /users/profile` | `JwtAuthGuard` | **implemented** — 200, updates `users` row |
| `GET /athlete/profile/:id` | `JwtAuthGuard`, `AthleteExistsGuard` | **implemented** — sparse-fieldset read |
| `POST /coach` | none | ⚠️ scaffolding |
| `GET /coach/athletes` | none | ⚠️ scaffolding |
| `GET /coach/athletes/:id` | none | ⚠️ scaffolding |
| `GET /coach/athletes/:id/program` | none | ⚠️ scaffolding |
| `PATCH /coach/athletes/:id` | none | ⚠️ scaffolding |
| `DELETE /coach/:id` | none | ⚠️ scaffolding |

"Scaffolding" means unmodified Nest CLI output: `coach.service.ts` returns string literals, and the routes are unguarded. They are not features.

Only one of these is called by the frontend at all (`POST /users/profile`).

---

## 6. Known limitations

The defects previously listed here have been fixed (see §8). What remains is deliberate or unverified rather than broken:

1. **`validationExceptionFactory` is unregistered by choice.** It reports only `errors[0]`, so enabling it trades multi-field validation feedback for friendlier wording. Its mappings also reference properties no DTO has (`email`, `password`, `age`, `phone`) and state a 3–20 username length where the DTO says 3–30.
2. **`users.email` and `users.role` are unverified.** Both are allowlisted for `?data=` queries but never written by the app, and `role` looks vestigial next to `is_athlete` / `is_coach`. They're excluded from the default `PUBLIC_PROFILE_QUERY` so it can't fail on a missing column, but an explicit `?data=users.role` may error against the live schema.
3. **`athletes.team_id` and `athletes.coach_id` are allowlisted but never written** — placeholders for the unbuilt teams and roster features. There is no `teams` table referenced anywhere.
4. **`createUserProfile` still isn't truly transactional** (see §4). Validate-early plus compensating deletes narrows the window; it doesn't close it.
5. **`users.e2e-spec.ts` hardcodes remote UUIDs** for federation, division, and weight class, so it only runs against a project containing those exact rows. `athlete-retrieve.e2e-spec.ts` shows the portable alternative — look reference data up at runtime.
6. **`PATCH /athlete/profile` was specced but never built.** `UpdateAthleteDto` captures the intended request shape — name-based `federation` / `division` / `weight_class` (e.g. `'IPF'`, `'Junior'`, `'66kg'`) rather than IDs, which would need resolving to IDs and cross-validating against gender and federation. The e2e spec that described this behavior was removed, since a test for unbuilt code only misleads. This is the design record for whoever builds it.

---

## 7. Known gaps

Not bugs — just not built yet. Useful for calibrating expectations.

- **No local database story.** No migrations, no seeds, no Supabase CLI directory. The schema lives only in the hosted project, so e2e tests hit production data and there's nothing to spin up offline. Adding migrations would be the single highest-leverage infrastructure change in the repo.
- **No frontend tests** at all, and no formatter on that side. CI covers lint + typecheck only.
- **No API client layer** on the frontend — one inline `fetch`.
- **No deploy workflow.** CI validates; nothing ships.
- **No `.env.example`** in either package, so env vars must be reverse-engineered from source.
- **Coach features are entirely unbuilt** despite the scaffolding, and the three tab screens are stubs.

---

## 8. Fixed defects

Kept as a record, because several of these changed observable behavior and a few produced non-obvious traps worth not re-introducing.

| Was | Now |
|---|---|
| `GlobalExceptionFilter` implemented but never registered; errors used default Nest shape | Registered in `main.ts`. Also rewritten to read `exception.getResponse()` — the original read `exception.message`, which for validation errors is only `"Bad Request Exception"`, so registering it as written would have silently destroyed per-field validation detail. Pinned by `global-exception-filter.spec.ts`. |
| Two e2e specs invisible to the runner (`.e2e.spec.ts` vs `testRegex: .e2e-spec.ts$`) | `testRegex` widened to `\.e2e[-.]spec\.ts$`; all three suites now run |
| `athlete-retrieve` spec authenticated via `POST /auth/login`, a nonexistent route, against a hardcoded athlete row | Rewritten: Supabase `signUp` for the token, fixture user + athlete row created and torn down in place, reference data looked up at runtime |
| `athlete-update` spec tested `PATCH /athlete/profile`, which does not exist | Deleted; intent preserved in §6.6 |
| `test/helpers/authHelper.ts` dead code reading undefined env names (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) | Deleted |
| `select.queries.ts` selected `users.name`, a column nothing writes — likely breaking the default profile query | Uses `first_name`, `last_name`. `role` dropped from the default query but still allowlisted |
| `createUserProfile` inserted a `coaches` row *before* validating athlete fields, and had no cleanup | Validates before any write; tracks inserts and compensates on failure |
| `users.e2e-spec.ts` omitted `forbidNonWhitelisted` and the filter, so it tested a config production didn't use | Mirrors `main.ts` |
| Frontend `reset-project` script pointed at a missing file and would have deleted `app/` | Removed from `package.json` |
| Tailwind `content` globs omitted `contexts/` and `lib/` | Both added |

Verified at the time of the change: backend lint, `tsc --noEmit`, `build`, and 33/33 unit tests pass; frontend lint and type-check pass. The e2e suites compile and load but **were not run** — they need live Supabase credentials, which CI supplies on PRs to `main`.
