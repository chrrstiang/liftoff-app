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
  → error response        DEFAULT NEST SHAPE
```

The last line is the surprise. `GlobalExceptionFilter` and `validationExceptionFactory` are both implemented, and would produce `{ statusCode, message, timestamp, path, method }` and constraint-specific exceptions respectively — but neither is registered in `src/main.ts`. They are referenced only by the two e2e specs that never execute. See "Known defects" below.

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

1. Inserts a `coaches` row if `is_coach` (`biography`, `years_of_experience`).
2. If `is_athlete`, cross-validates before inserting:
   - `division_id` must belong to the given `federation_id`
   - `weight_class_id` must match both `federation_id` **and** `gender`
   - either check without a `federation_id` is a 400
3. Inserts the `athletes` row.
4. Updates the `users` row with the general fields.

These are **application-level** foreign-key checks — there's no guarantee the database enforces the same, so keep them when touching this path. Note the sequence isn't transactional: a failure at step 4 leaves the athlete/coach rows already inserted.

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

## 6. Known defects

Documented deliberately rather than fixed — each is a behavior change deserving its own commit and review. Please don't repair them as a side effect of unrelated work.

1. **Error-handling layers unregistered.** `GlobalExceptionFilter` and `validationExceptionFactory` are implemented but absent from `src/main.ts`. All error responses use default Nest shape. Wiring them changes every error response in the API.
2. **Two e2e specs never run.** `jest-e2e.json` has `testRegex: ".e2e-spec.ts$"`, but `athlete-retrieve.e2e.spec.ts` and `athlete-update.e2e.spec.ts` use `.e2e.spec.ts`. Fix by renaming the files or widening the regex to `\.e2e[-.]spec\.ts$`.
3. **…and they'd fail anyway.** Both `POST /auth/login`, a route that does not exist. They need rewriting against Supabase auth (as `users.e2e-spec.ts` does) before they can pass.
4. **`test/helpers/authHelper.ts` is dead and wrong.** Never imported, and reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` — names neither the app nor CI defines.
5. **`users.name` vs `first_name`/`last_name`.** `select.queries.ts` allowlists `users.name` and `PUBLIC_PROFILE_QUERY` selects it, but every write path uses `first_name` / `last_name`. If the default `GET /athlete/profile/:id` fails on an unknown column, this is why. Needs checking against the live schema — `role` is likewise allowlisted but never written.
6. **Frontend `reset-project` script is broken** — points at a missing `scripts/reset-project.js` and would delete `app/` if it existed.
7. **Tailwind `content` globs omit `contexts/` and `lib/`**, so classes written there are silently never generated.
8. **`createUserProfile` is not transactional** (see §4).

---

## 7. Known gaps

Not bugs — just not built yet. Useful for calibrating expectations.

- **No local database story.** No migrations, no seeds, no Supabase CLI directory. The schema lives only in the hosted project, so e2e tests hit production data and there's nothing to spin up offline. Adding migrations would be the single highest-leverage infrastructure change in the repo.
- **No frontend tests** at all, and no formatter on that side. CI covers lint + typecheck only.
- **No API client layer** on the frontend — one inline `fetch`.
- **No deploy workflow.** CI validates; nothing ships.
- **No `.env.example`** in either package, so env vars must be reverse-engineered from source.
- **Coach features are entirely unbuilt** despite the scaffolding, and the three tab screens are stubs.
