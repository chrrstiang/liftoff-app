# Authorization

The authoritative map of who may reach what. **There is no RLS in RDS — the API is the
entire trust boundary**, so every cell below is application code, and a wrong one is a
data breach rather than a bug.

Audited 2026-09-04 by reading every controller and service against every spec. Each row
cites the code that enforces the rule and the assertion that pins it. A row with no
assertion is a hole, and is marked as one.

**One endpoint postdates the audit:** `PATCH /athlete/profile`, added with the
profile-editing screen. It is in the `athlete` matrix below with its unit assertions
and an explicit note that it has no e2e coverage yet.

**All seven holes the audit found are closed** (2026-09-04). The e2e suite went from
103 tests to 134. Closing them turned up one live bug — avatar upload had been broken
since it shipped — which is recorded as Finding 4. The findings below are kept as the
record of what was wrong and why, not as an open list.

**Caller roles used throughout:** *owner* (the resource is theirs), *related* (their coach
or athlete), *outsider* (an authenticated user with no claim), *anon* (no token).

---

## Finding 1 — `CoachController` was entirely unauthenticated — FIXED

**Six live routes carried no `@UseGuards`.** `src/users/controller/coach/coach.controller.ts`
declares them at lines 10, 15, 20, 25, 30, and 35; the file contains no `UseGuards` import.
The controller is registered in `src/users/users.module.ts:15`, and `UsersModule` is in
`AppModule`, so they are served.

Verified against production on 2026-09-04:

```
GET /coach/athletes            → HTTP 200, no token   "This action returns all users"
GET /users/me                  → HTTP 401, no token   {"statusCode":401,"message":"No token provided",…}
```

| Route | Method |
|---|---|
| `/coach` | POST |
| `/coach/athletes` | GET |
| `/coach/athletes/:id` | GET |
| `/coach/athletes/:id/program` | GET |
| `/coach/athletes/:id` | PATCH |
| `/coach/:id` | DELETE |

**No data is exposed today.** `src/users/service/coach/coach.service.ts` is untouched Nest
scaffolding — every method returns a hardcoded string and none of them opens a database
connection. There is no `@Inject(DRIZZLE)` in the file.

**Why it still matters.** The exposure is latent, not absent. Whoever implements
`CoachService` inherits a controller that authenticates nobody, and the two mutation routes
(`PATCH /coach/athletes/:id`, `DELETE /coach/:id`) are the ones where that goes from a
disclosure to a write. The controller's only unit spec
(`coach-controller.spec.ts:17`) asserts `should be defined`, so nothing would fail.

This is also the one place where CLAUDE.md's "assume a feature does not exist until you've
read the code" cuts the other way: the module is *unimplemented*, which reads as harmless,
but it is *mounted*, which is not.

**Resolution: deleted.** `controller/coach/`, `service/coach/` and `dto/coach/` are gone,
along with their two `should be defined` specs, and `UsersModule` no longer registers
them. Guarding them was the alternative; deleting won because nothing called them — no
backend reference outside their own files, no frontend caller — and an unauthenticated
placeholder is a trap for whoever implements the service later. Git remembers the
scaffolding if it is ever wanted back.

---

## Finding 2 — the `?data=` allowlist was asserted by example, not by contents — FIXED

`src/common/types/select.queries.ts:15` is the only thing constraining what
`GET /athlete/profile/:id` exposes. It deliberately excludes `email` (another user's PII)
and `role` (not a real column), and the reasoning is in the comment above it.

`test/users/athlete/athlete-retrieve.e2e-spec.ts:171` rejects six specific `?data=` shapes,
including `user_id` and `users.id`. But every one of those tests names a query that is
*already* absent from the allowlist. **Re-adding `email` to `VALID_TABLE_FIELDS` would pass
the entire suite** — nothing asserts what the allowlist *contains*, only that particular
strings are missing from it.

**Resolution: both.** `src/common/types/select.queries.spec.ts` pins all three allowlists
by their exact contents, and `athlete-retrieve.e2e-spec.ts:182` adds `?data=users.email`
to the rejected-query table — the one rejection there that would return real PII rather
than 500 if the list were widened.

That spec is *designed to fail* when someone widens an allowlist: the failure is the
review prompt, and the fix is to change the spec deliberately, not to make it pass. It
was verified by re-adding `email` to `VALID_TABLE_FIELDS.users` and confirming the suite
went red, then reverting.

---

## Finding 3 — five endpoints had no authorization assertions — FIXED

| Endpoint | Coverage |
|---|---|
| `GET /exercises/templates` | **none** — the string `exercises/templates` appears nowhere in `test/` |
| `GET /users/me` | **none** — `users/me` appears nowhere in `test/` |
| `POST /exercises` | happy path and empty-name only; **nothing asserts a non-coach is rejected**, so `assertCoach` (`exercises.service.ts:49`) is unpinned |
| `PATCH /users/profile` | **no e2e** — `users.e2e-spec.ts` covers only `POST /users/profile` |
| unauthenticated access | **no case** in `users.e2e-spec.ts` or `coaching-messaging.e2e-spec.ts` (both have zero occurrences of `401`) |

**Resolution:** all five now have assertions — `programming:220` for the coach check,
`programming:234` for the template list, and `users:373` / `users:439` / `users:512` for
the three users routes. Line-by-line coverage is in the matrix below.

One constraint shaped how: auth users still come from the shared Supabase project, whose
signup limit is per-hour and cumulative across CI runs, and per-test signups are what made
this suite flaky in the first place. The new users coverage therefore shares **three**
auth users across two describes rather than creating one per test — ten would have quietly
undone that fix.

`GET /users/me` is worth singling out: its 404 is load-bearing. Per
`docs/ARCHITECTURE.md` §2, that 404 is the signal the auth gate uses to route a
half-registered user to create-profile, and nothing tested it.

---

## Finding 4 — `PATCH /users/profile` rejected every real request — FIXED

Not found by reading the code. Found because closing Finding 3 meant writing the first
e2e for this endpoint, and it failed immediately: `{}` returned **400**, and so did
`{ avatar_url: '…' }`.

`UpdateUserDto` declared `name?: string` with `@IsNotEmpty()` and `@IsString()`. The trap
is that **`PartialType` only relaxes fields it inherits** — `name` was not on
`CreateUserDto`, so no `@IsOptional()` was ever applied to it and its `@IsNotEmpty()` ran
on every request. Any PATCH omitting `name` was a 400.

The field mapped to nothing. There is no `name` column — the schema has `first_name` and
`last_name` — and `updateProfile` never read `dto.name`.

**The visible effect:** `frontend/lib/api/storage.ts:63` sends `{ avatar_url }` and
nothing else, so **avatar upload had been broken since it shipped** in `42128c7`, and it
failed *after* the image was already written to the Supabase bucket. Nothing caught it
because this endpoint had no e2e coverage — that was Finding 3.

`username` sits directly below and looks identical, but is safe for the one reason that
matters: it *is* on `CreateUserDto`, so `PartialType`'s `@IsOptional()` covers it and
short-circuits the rest. **Any field declared on `UpdateUserDto` rather than inherited
needs an explicit `@IsOptional()`** — `avatar_url` has one.

**Resolution:** `name` deleted, the trap documented on the DTO, and `users:473` pins the
exact avatar-only request the client sends.

Worth noting what this says about the audit method. Reading the code found six holes in
coverage; only writing the tests found the bug. A mocked unit spec would not have caught
it either — `users.controller.spec.ts` was *passing a `name` field*, so it encoded the
broken shape as correct.

---

## The matrix

### `users`

| Endpoint | Rule enforced | Where | Outsider assertion | Anon |
|---|---|---|---|---|
| `GET /users/me` | id from token | `users.service.ts:138` | `users:401` (own row only) | `users:515,520` |
| `POST /users/profile` | id + email from token | `users.service.ts:32` | n/a — no id in request | `users:527` |
| `PATCH /users/profile` | `eq(users.id, user.id)` | `users.service.ts:178` | `users:454` (touches only the caller) | `users:533` |

No id is accepted from the request on any of these, so the cross-user surface is not an
id to tamper with — it is whether the service keeps its `eq(users.id, user.id)` scope.
`users:454` is the assertion that would catch an unscoped `update users set ...`, which
with no RLS would succeed and rewrite the whole table.

Two behaviours here are load-bearing and now pinned: **`GET /users/me` returning 404 is a
normal state** (`users:383`) — the auth gate reads it as "route to create-profile" — and a
PATCH against a user with no row must not conjure one (`users:411`).

### `athlete`

| Endpoint | Rule enforced | Where | Outsider assertion | Anon |
|---|---|---|---|---|
| `GET /athlete/profile/:id` | public to any authenticated caller; fields capped by allowlist | `select.queries.ts:15` | `athlete-retrieve:171` (7 rejected shapes, incl. `users.email` at `:182`) + `select.queries.spec.ts` pins the allowlist itself | `athlete-retrieve:208,213` |
| `GET /athlete/search` | excludes caller and already-invited | `athlete.service.ts:239` | `programming:552,560` | `programming:660,666` |
| `PATCH /athlete/profile` | `eq(athletes.id, user.id)` on both the read and the write | `athlete.service.ts` → `updateOwnProfile` | **unit only** — `athlete.service.spec.ts` "scopes the read and the write to the id from the token" and "cannot be redirected by an id smuggled into the body"; **no e2e yet** | **none yet** |

`PATCH /athlete/profile` is the one row here whose assertions are unit rather than
e2e, and by the standard the rest of this file sets that is a partial hole. It is
recorded rather than hidden. Two things narrow it: the route takes **no id at all**
— not in the path, not on `UpdateAthleteDto` — so there is no id to tamper with and
the cross-user surface is only whether the service keeps its scope, which is what
the two unit assertions compare against a freshly built `eq(athletes.id, CALLER)`;
and `@UseGuards(JwtAuthGuard)` is on the route, which is the thing Finding 1 shows
goes wrong when it is missing. What is still missing is the anon case and an
outsider case against a real database, and `users.e2e-spec.ts` is the model to
follow — `users:454` for the "touches only the caller" shape and `users:533` for
the 401.

**Athlete profiles are intentionally public to authenticated users** — `first_name`,
`last_name`, `username`, `gender`, plus reference data. That decision is already made and
recorded in the allowlist comment; it is not an open question. `user_id` stays out because
it exposes the auth uid. Missing athlete → 404 via `AthleteExistsGuard`
(`athlete-exists-guard.ts:43`), asserted at `athlete-retrieve:195`.

### `coach-requests`

| Endpoint | Rule enforced | Where | Outsider assertion | Anon |
|---|---|---|---|---|
| `POST /coach-requests` | caller must be a coach; names themselves | `coach-requests.service.ts:49` | `coaching:174,185` | `coaching:477` |
| `PATCH /coach-requests/:id` | only the named athlete, only from `pending` → 404 | `coach-requests.service.ts:133` | `coaching:232,236` | `coaching:477` |
| `GET /coach-requests` | `eq(athleteId, callerId)` | `coach-requests.service.ts:177` | `coaching:224` | `coaching:477` |
| `GET /coach-requests/roster` | `eq(coachId, callerId)` + `active` | `coach-requests.service.ts:204` | `coaching:283` | `coaching:477` |

`coaching:185` is the one that matters most: a client-supplied `coach_id` is a 400, not a
silent overwrite. The relationship row is derived from the stored accepted request inside a
transaction (`coach-requests.service.ts:141`), never from client input.

### `conversations` / `messages`

| Endpoint | Rule enforced | Where | Outsider assertion | Anon |
|---|---|---|---|---|
| `POST /conversations` | **an active coach/athlete relationship between the two, either direction** → 404. Server owns membership; self-chat is 400 | `conversations.service.ts` | `coaching:373` (client `sender_id` rejected) | `coaching:477` |
| `GET /conversations` | `eq(conversationMembers.userId, callerId)` | `conversations.service.ts:148` | `coaching:413,424` | `coaching:477` |
| `GET /conversations/:id/messages` | `assertMember` → 404 | `conversations.service.ts:158` | `coaching:387` | `coaching:477` |
| `POST /conversations/:id/messages` | `assertMember` → 404 | `conversations.service.ts:193` | `coaching:390,394` | `coaching:477` |
| `POST /conversations/:id/read` | `assertMember` → 404 | `conversations.service.ts:219` | `coaching:391` | — |

`assertMember` (`conversations.service.ts:21`) throws `NotFoundException`, so a non-member
cannot tell a conversation exists. `coaching:394` additionally asserts the non-member's
message was never written — a denial that returns the right status but still persists the
row would pass without it.

### `workouts` / `sets` / `exercises`

| Endpoint | Rule enforced | Where | Outsider assertion | Anon |
|---|---|---|---|---|
| `GET /workouts?athlete_id=` | self, or active coach → else 404 | `workouts.service.ts:126` | `programming:356` | `programming:660` |
| `GET /workouts/history?athlete_id=` | gate: `assertReadableAthlete` → 404. Row scope: `historyVisibilityFilter` — every session assigned to the athlete, whoever authored it | `programming-access.ts` | `programming` "history with two coaches" | `programming` "401s on … without a token" |
| `GET /exercises/:id/history?athlete_id=` | same gate and same filter | `programming-access.ts` | `programming` "scopes exercise history the same way" | as above |
| `GET /workouts/templates` | `templateVisibilityFilter` — `coach_id = caller` **and** `athlete_id is null`. Deliberately **not** widened to co-coaches: a template has no athlete, so there is nobody to be a co-coach of | `programming-access.ts` `templateVisibilityFilter`, pinned as compiled SQL in `programming-access.spec.ts` | `programming` "does not show one coach's templates to another", "does not put the template in another coach's library" | `programming:660` |
| `GET /workouts/:id` | `loadReadableWorkout` → 404. Self, author, **or any active coach of the athlete** | `programming-access.ts:75` | `programming:395,400` | `programming:660` |
| `POST /workouts` | caller must be coach; athlete must be on roster; `coach_id` from token | `workouts.service.ts:246,264` | `programming:229,242,257,269` | `programming:660` |
| `POST /workouts/:id/exercises` | `loadProgrammableWorkout` → 404 then 403. **Authoring coach only** — a co-coach reads it but gets 403 | `programming-access.ts:97` | `programming:503,514` | `programming:660` |
| `POST /workouts/:id/assign` | source: `loadReadableWorkout` → 404. Each target: `isActiveCoachOf` → 404 naming the **athlete**, checked for all before any write | `workouts.service.ts` | `workouts.service.spec.ts` "refuses when a target athlete is not on the caller's roster" | — **unit only** |
| `POST /workouts/:id/save-as-template` | `loadReadableWorkout` → 404. Then, in order: a source that is already a template → 400; **the athlete is excluded** → 403 — reading your own session is not authoring a library entry, and `coach_id` is an FK into `coaches`, so an athlete reaching the insert 500'd rather than being refused | `workouts.service.ts` `saveAsTemplate` | `programming` "404s a caller with no claim on the source", "refuses the athlete, and does not 500 doing it" | `programming:660` |
| `DELETE /workouts/:id` | `loadProgrammableWorkout` | `workouts.service.ts:468` | `programming:527` | `programming:660` |
| `PATCH /sets/:id` | walk to workout → 404; performer only → 403 | `workouts.service.ts:432,437` | `programming:425,430` | `programming:660` |
| `GET /exercises` | `eq(createdBy, callerId)` | `exercises.service.ts:27` | `programming:212` | `programming:660` |
| `POST /exercises` | caller must be a coach | `exercises.service.ts:49` | `programming:220` | `programming:660` |
| `GET /exercises/templates` | `eq(createdBy, callerId)` | `exercises.service.ts:82` | `programming:271,280` | `programming:660` |
| `GET /maxes?athlete_id=` | `assertReadableAthlete` → 404. **Wide**: the athlete, or any active coach | `maxes.service.ts` | `maxes.service.spec.ts` "404s a caller with no claim" | — **unit only** |
| `PATCH /maxes/:exerciseId` | `isActiveCoachOf` → 404, **then** the exercise must be in the caller's own library | `maxes.service.ts` | `maxes.service.spec.ts` "refuses the athlete", "refuses an exercise outside…" | — **unit only** |
| `POST /maxes/refresh` | `isActiveCoachOf` → 404 | `maxes.service.ts` | `maxes.service.spec.ts` "refuses a caller who does not coach" | — **unit only** |
| `GET /adherence` | **no id in the request.** The query starts from `coach_athlete_relationships` scoped to the caller, so it cannot reach an athlete who is not theirs | `adherence.service.ts` | `adherence.service.spec.ts` "returns an empty list for a caller with no roster" | — **unit only** |

`programming-access.ts` is the worked example the rest of the codebase should follow: the
`sets → workout_exercises → workouts` walk is one joined query, not three lookups, so it
cannot be half-authorized. `isPerformer` is the rule that keeps a coach from falsifying what
an athlete lifted.

**The cross-coach case is covered.** `stranger` is seeded as both athlete and coach
(`programming:102`), so `programming:356` — a second coach getting 404 on another coach's
athlete — is a genuine coach-vs-coach assertion, not just an unrelated-user one.

**Reads are wide, writes are narrow, and the asymmetry is the whole rule.** An
athlete may have more than one coach (decided 2026-09-17), so "may read this
athlete" and "may change this workout" are two different questions. As of
2026-09-20 they are answered as follows, and this is the summary to read before
touching any of the three functions:

| Action | Who | Enforced by |
|---|---|---|
| **Read** an athlete's sessions | the athlete, and **any active coach of them** — whoever authored the session | `assertReadableAthlete` (gate) + `historyVisibilityFilter` (row scope) + `loadReadableWorkout` (single workout) |
| **Read** an athlete's maxes | the athlete, and **any active coach of them** | `assertReadableAthlete` |
| **Change** a workout's structure | the **authoring coach only** | `loadProgrammableWorkout` |
| **Set or refresh a max** | **any active coach**, never the athlete | `isActiveCoachOf` |
| **Record what was lifted** (`actual_*`, `is_completed`) | the **athlete only**, or the owning coach on a template | `isPerformer` |

⚠️ **Maxes read wide but write narrow, and the write rule is narrower than the read
rule *in a different direction* from workouts.** An athlete may read their own
maxes but may not set them: a max drives the percentages they are prescribed, so
writing one is programming. Meanwhile any active coach may write, not only the one
who authored the exercise — because unlike a workout, a max is a property of the
athlete rather than of a coach's programming.

⚠️ **The three `/maxes` routes are pinned by unit tests only.** There is no e2e
coverage, so the anon case and the real-database join are unasserted. The unit
specs mock Drizzle entirely, which means a column-name mistake in the
`sets → workout_exercises → workouts` walk inside `loggedSetsFor` would not be
caught. Same gap and same reason as `PATCH /athlete/profile`.

Reading another coach's programming is coordination — a coach writing next week
needs to know what the athlete actually did, including under someone else, and
three coaches sharing a Google Sheet had that for free. Silently rewriting or
deleting it is not, and has a far larger blast radius, so writes stayed put.

Two consequences worth knowing:

- **A co-coach attempting a write gets a 403, not a 404, and that is correct.**
  404-over-403 exists so a caller with *no* claim cannot confirm an id is real. A
  co-coach demonstrably can read the workout, so the 403 reveals nothing they could
  not already see — and "not yours to change" is the more useful answer.
- **Templates are excluded from the co-coach case.** A template has `athlete_id`
  null, so there is no athlete to be a co-coach *of*; it stays private to its
  author. `loadReadableWorkout` null-guards before consulting relationships.

`historyVisibilityFilter` deliberately **no longer takes a `callerId`**. It did
while the rule varied by caller; keeping the parameter would imply a per-caller
restriction that no longer exists. Re-adding it is the first move of any change
that re-narrows this, which is why `programming-access.spec.ts` pins the arity.

The history routes still separate the gate from the row scope even though the two
now agree. The gate has to run: without it the filter alone would return an empty
list for a stranger, which answers "is this user training with me?" for any id —
exactly the leak the 404 exists to prevent.

`GET /workouts?athlete_id=` never applied the filter and now does not need to —
the two reads finally agree. They disagreed for exactly one release.

`programming-access.spec.ts` is also the one spec in this repo that asserts
compiled SQL. It has to: the shared Drizzle double routes results by table and
ignores `where` by design, so **no service-level unit test can show that a filter
excluded a row** — dropping the `coach_id` term would leave every other spec green.

---

## Where 403 is used instead of 404, and why

The house rule is 404 over 403, because a 403 confirms the id names something real. Three
places return 403 on purpose:

1. **Caller lacks a role.** "Only a coach can create a workout"
   (`workouts.service.ts:246`), same for exercises and invites. This is a fact about the
   caller, not about a resource id, so it leaks nothing.
2. **Caller can read but not write.** `loadProgrammableWorkout` checks read access first, so
   an outsider gets 404 and only someone who can already see the workout gets the 403.
   Same shape for `PATCH /sets/:id` returning 403 to the coach.
3. **`POST /workouts` distinguishes "no such athlete" (404, line 259) from "not on your
   roster" (403, line 265).** This one *is* a deviation — a coach can tell the two apart.
   It is defensible because athlete existence is already public via `/athlete/search` and
   `/athlete/profile/:id`, so nothing is learned that the profile endpoint would not tell
   you. Recorded here so it reads as a decision rather than an oversight.

---

## What was closed

All seven, on branch `harden-authorization-boundary`. Verified locally: `npx tsc --noEmit`
clean, `npm test` 9 suites / 107 tests, `npm run test:e2e` **5 suites / 134 tests** (up
from 103), eslint 0 errors, and the fixture tables counted back to zero rows afterwards
rather than trusting the green run.

| # | Hole | Closed by |
|---|---|---|
| 1 | `CoachController` authenticated nobody | deleted, with `CoachService` and `dto/coach/` |
| 2 | `POST /exercises` never tested the coach check | `programming:220` |
| 3 | `GET /exercises/templates` had no test at all | `programming:234` (4 cases) |
| 4 | `?data=` allowlist not pinned by contents | `select.queries.spec.ts` + `athlete-retrieve:182` |
| 5 | `GET /users/me` untested, incl. the load-bearing 404 | `users:373` (5 cases) |
| 6 | `PATCH /users/profile` had no e2e | `users:439` (7 cases) — and it found Finding 4 |
| 7 | no unauthenticated case in two specs | `users:512`, `coaching:449` |

The `coaching:449` block is worth keeping in mind for new routes: every other rule in that
file is stated in terms of *who the caller is*, which silently presumes the guard ran.
A route declared without `@UseGuards(JwtAuthGuard)` would leave `req.user` undefined and
each ownership check comparing against `undefined` — and would have passed the entire
suite. Finding 1 is what that looks like when it actually happens.

### Deliberately not fixed

**`@IsUnique('users','username')` matches the caller's own row**, so re-sending your
current username is rejected as a collision with yourself. Pinned at `users:506` as a
known rough edge rather than a desired behaviour. The fix means excluding the caller's
id from the uniqueness query, which changes the validator's signature.

The settings screen this entry anticipated now exists (`app/(app)/edit-profile.tsx`),
so "nothing hits it because the client only sends changed fields" has stopped being
luck and become a constraint the client has to keep. It diffs every field against the
loaded profile and sends only what changed; that is documented on `ProfilePatch` and
`lib/api/users.ts` so a later refactor to "just PATCH the whole form" is recognisable
as the 400 it would be.

## What this audit found to be already correct

Recorded because the docs undersold it, and re-deriving it cost most of the audit:

- Coaching, messaging, and programming all scope every read and write, and all use 404 for
  a caller with no claim.
- `GET /workouts?athlete_id=` cannot be pointed at another coach's athlete, and that is
  tested.
- Athlete search is fully covered, including the literal-`%` and literal-comma cases that
  were once injection bugs.
- `email` and `role` are already out of the profile allowlist.
- No endpoint takes an actor id from the request body; `coach_id` and `sender_id` are both
  400s.

The docs undersold the state in both directions, which is the argument for keeping this
file next to the code rather than in prose: `MIGRATION-PROGRESS.md` (now at
`docs/archive/`) still described the authorization review as an open block after most of it
was already done, while `backend/CLAUDE.md` described the coach scaffolding as harmless and
the profile allowlist as still exposing `email`. Both have been corrected.
