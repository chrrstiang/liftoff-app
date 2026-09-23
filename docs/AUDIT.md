# App audit — 2026-09-22

A feature-by-feature pass over the whole app, done alongside the four PRs that
closed the roadmap cutline (#36, #37, #38, #39). Every finding below was verified
by reading the code, and several by executing queries against a local Postgres —
where that happened, it says so.

## If you read one thing

Three items would change what a real user experiences, and none of them are
features:

1. ~~**Any signed-in user can DM any other user.**~~ **Fixed** — creation now
   requires an active coach/athlete relationship, and athlete search is coach-only.
   A block list is still unscoped.
2. ~~**A returning user on a bad connection is dropped into the signup form.**~~
   **Fixed** — the gate now holds on an unknown profile instead of guessing.
3. **Production is very likely broken right now.** Merging tonight's PRs
   auto-deployed code that needs migration 0003, and nothing in the deploy
   pipeline applies migrations. The workout detail screen and all of maxes are
   the likely casualties. See finding 3 — it has the fix.

The first two need fixing before the team migration. **The third needs a command
run now**, and a pipeline change so it stops recurring.

Two more that are not emergencies but will make migration week miserable:
**eight of eleven screens render a failed request as "you have nothing"**, and
**workouts written after ~8pm are saved on the wrong day**.

---

**Ordered by what I would fix first**, not by where it lives. Each item states the
failure concretely enough to decide with, rather than just naming a smell.

Line numbers are as of commit `main` at the time of writing and drift with any
edit — the symbol names beside them are the durable reference.

Nothing here has been changed. Bugs found *while building* the four PRs were fixed
in those PRs and are listed separately at the end so the record is complete.

---

## 🔴 Fix before real users

### 1. ~~Any signed-in user can DM any other user~~ — FIXED

`messaging/service/conversations.service.ts` → `createConversation` checks two
things: that you are not messaging yourself, and that the target exists. **There
is no check that the two users are related in any way.**

`GET /athlete/search?q=` is also not coach-gated — it takes `callerId` only to
*exclude* athletes you have already invited, never to verify you are a coach. So:

1. Search any name (3+ characters, up to 20 results).
2. Take the `athlete_id` from the response.
3. `POST /conversations` → a thread exists, with you as a member.
4. `POST /conversations/:id/messages` → `assertMember` passes, because step 3
   made you one.

Every downstream rule is correct. `assertMember` is properly enforced on reading,
sending and marking read. The gap is that **membership itself was never gated**,
so the guard checks a door the caller already walked through.

`docs/AUTHORIZATION.md:217` describes this row as *"server owns membership;
self-chat is 400"* — accurate about what it does, silent about what it does not.
I found nothing recording open DMs as a deliberate choice.

**Why this ranks first:** the app is aimed at ~50 students on one team.
Unsolicited messaging between students, with no block and no report, is a safety
question rather than a missing feature, and it needs answering before the app is
in real hands rather than after.

**Fixed.** `createConversation` now requires an active relationship between the
two users in **either** direction — a bidirectional check rather than
`isActiveCoachOf`, because a coach messaging their athlete and an athlete
messaging their coach are the same conversation and neither side should have to
be the one to start it. `searchAthletes` now asserts the caller is a coach,
closing the chain at its source.

The gate is on **creation only**: existing conversations keep working through
`assertMember`, so the tightening cannot cut anyone off from a thread they are
already in — including one that outlives the relationship that justified it.

Still worth scoping separately: **a block list**. This makes unsolicited contact
impossible between strangers; it does not give anyone a way out of a conversation
they no longer want.

### 2. ~~A returning user on a bad connection is sent to create-profile~~ — FIXED

`contexts/AuthContext.tsx:51` initialises `isProfileComplete` to `false`, and
`loadProfile` deliberately does not set it on a non-404 failure. The intent is
right and the comment says so:

> *"Any other failure deliberately leaves `isProfileComplete` alone rather than
> setting it false… a dropped connection was indistinguishable from a missing
> profile and bounced the user out of their session mid-use."*

**But "leaves it alone" means leaving it at the initial `false` on the first
load**, which is the common case rather than the rare one:

1. `INITIAL_SESSION` restores the session → `isAuthenticated = true`.
2. `GET /users/me` fails — backend down, gym wifi, or `EXPO_PUBLIC_API_URL`
   pointing at `localhost` from a physical device (the single most common setup
   failure, per `frontend/CLAUDE.md`).
3. Not a 404, so `setIsProfileComplete` is never called; the value stays `false`.
4. The gate sees `isAuthenticated && !isProfileComplete` → **create-profile**.

**Then it gets worse.** `POST /users/profile` *inserts* the `users` row — it does
not upsert — so submitting the form against an existing row fails on the primary
key and surfaces as a 400 reading `23505 - Key (id)=(…) already exists`. The user
is on a screen they cannot leave and cannot complete.

**Fixed.** `isProfileComplete` is now `boolean | null`, starting at `null`, and a
non-404 failure leaves it there. The gate checks `=== null` **explicitly** — the
subtlety being that `null` is falsy, so every existing `!isProfileComplete` would
otherwise have gone on treating unknown as incomplete and TypeScript would not
have said a word.

While it is null the gate **holds** rather than routing, and if there is a known
cause it shows a reachability error with a retry instead of an indefinite spinner.
Holding is always recoverable; routing to create-profile is not.

### 3. Deploying now would ship code against a database that lacks its tables

`deploy.yml` builds the image, registers a task definition and rolls the service.
It does **not** run migrations — deliberately: RDS is `--no-publicly-accessible`,
so migrations run as a one-off Fargate task inside the VPC (`infra/README.md`),
which is a manual step.

Merging #36 armed a trap. `main` now contains code querying `athlete_maxes` and
`sets.prescribed_percent`; a deploy ships that to a database where neither exists,
and every `/maxes` call and every workout read 500s until someone runs the migrate
task by hand.

**⚠️ This stopped being hypothetical while the audit was being written.** Merging
#36–#39 triggered `deploy.yml` three times (it fires on any push to `main`
touching `backend/**`), and the deploys were **real, not skipped** —
`AWS_DEPLOY_ROLE_ARN` is set, and the last run reported
`rolled: the running container reports 14294e86…`. Production has been serving
code that needs migration 0003 since roughly 04:56 UTC on 2026-09-22.

`GET /health` still returns `ok` because it deliberately does not touch the
database, so nothing external signals the problem.

**Very likely broken right now** (these select `sets.prescribed_percent` or read
`athlete_maxes`):

| Endpoint | What it is |
|---|---|
| `GET /workouts/:id` | **the workout detail / logging screen** |
| `GET /exercises/:id/history` | exercise history |
| `GET /workouts/templates` | template picker |
| `GET /maxes`, `PATCH /maxes/:id`, `POST /maxes/refresh` | all of maxes |
| `POST /workouts`, `POST /workouts/:id/exercises`, `POST /workouts/:id/assign` | they insert the new column |

**Probably still fine:** `GET /workouts?athlete_id=` (the home screen list selects
only id, name and date), all messaging, profile and roster routes.

I could not confirm it: RDS is `--no-publicly-accessible`, every data endpoint is
guarded so an external probe only ever returns 401, and the local AWS session has
expired (`aws login` is interactive). I also did not roll back — the app is
pre-release with no real users, so the cost of leaving it overnight is close to
zero, while an unsupervised production rollback that might be unnecessary is not.

**To fix:** authenticate (`aws sso login --profile liftoff`), run the migrate task
from `infra/README.md` → "Applying migrations to RDS", and confirm it prints
`done: 19 tables, 5 views, 3 federations`. The task is idempotent, so running it
when it was not needed is harmless. No redeploy is required afterwards — the
running container picks the schema up on its next query.

**Before the next deploy:** run the migrate task from `infra/README.md`. Migration
first, then deploy; the reverse is an outage.

**Fixed in the pipeline.** `deploy.yml` now builds a migration image, runs the
one-off task, and **fails the deploy** if it exits non-zero — before the service
rolls, so a failed migration leaves the currently running code untouched rather
than shipping over a schema that cannot serve it.

It runs on every deploy rather than only when `migrations/` changed. `migrate.ts`
is idempotent, so a no-op costs a minute, and "did the diff touch migrations" is
exactly the kind of detection that is wrong once and silently wrong forever after.

⚠️ **The deploy role needed two new permissions for this** (`ecs:RunTask` +
`ecs:DescribeTasks`, scoped to the `liftoff-migrate` family, and
`logs:GetLogEvents` on the one log group). `infra/iam/github-deploy-role.json` is
updated and validates clean through Access Analyzer, but **applying it to the live
role is a manual step** — see the PR for the command. Until it is applied, deploys
fail at the migration step, which is the safe direction but does block deploying.

The original reasoning, kept because it is why this was worth doing:

Everything needed already exists and is *deliberately* manual: `src/db/migrate.ts`
applies the chain and the seed, is idempotent, and is the script the one-off ECS
task runs via `Dockerfile.migrate`. Its own header explains why it runs inside the
VPC rather than from a laptop, and that reasoning is sound — it should stay.

The gap is narrower than "no migration runner": **nothing sequences it against the
deploy**, so the ordering lives entirely in whoever remembers to read the runbook.
A pre-deploy step that runs the existing task and waits, before
`update-express-gateway-service`, would close it without changing how migrations
actually execute. Failing that, a guard that fails the deploy when `migrations/`
changed in the diff — loud beats silent.

---

## 🟠 Will bite during the team migration

### 4. ~~A failed read is indistinguishable from empty data~~ — FIXED

**Eight of the eleven screens that run a `useQuery` have no error branch.** Only
`history/workout/[workoutId].tsx` did; `maxes/[athleteId].tsx` and
`adherence/index.tsx` were built with one tonight, which is the pattern to copy
rather than evidence the problem is shrinking.

TanStack Query returns `data: undefined` on failure, and every one of these
screens branches on exactly that — so **a backend that is down renders the empty
state**:

- Home tells an athlete *"Nothing scheduled — when your coach assigns a workout,
  it shows up here"* when their coach assigned four.
- Roster shows a coach with seventeen athletes an empty roster.
- The inbox shows no conversations.

Worse than a visible error: the app confidently states something false, and the
user's reasonable conclusion is that their coach did nothing. It is also the
failure most likely during migration week — phones, gym wifi.

`describeApiError` already exists and already handles the non-obvious case (a raw
`TypeError` becomes *"Could not reach the server…"*). The screens just never use
it for reads, only for mutations.

Affected: `conversations/conversations.tsx`, `home.tsx`, `program/[athleteId].tsx`,
`roster/roster.tsx`, `conversations/[conversationId].tsx`, `edit-profile.tsx`,
`roster/[athleteId].tsx`, `workout/[workoutId].tsx`.

**Fixed.** A `QueryError` component in `components/ui`, wired into every screen
that reads. Seven gained an error branch they did not have; one
(`roster/[athleteId].tsx`) had one that was *misleading* rather than missing.

Two corrections to this finding, found while fixing it:

- **`roster/[athleteId].tsx` did handle errors** — it rendered *"Athlete not found
  — may have been removed from your roster"* for **any** error, so a moment of bad
  wifi told a coach their athlete was gone. That is the same lie in different
  clothes. It now distinguishes a real 404 from everything else.
- **`program/[athleteId].tsx` did not render the empty state on failure** — its
  guard was `isLoading || !workoutData`, and `!workoutData` is true on failure
  too, so a failed request produced a **spinner that never resolved**. Different
  failure, equally bad.
- **The two history screens were already correct**, using `isError` rather than
  `error`. My original scan grepped for the wrong idiom and undercounted them.

### 5. ~~Workouts created in the evening are filed a day late~~ — FIXED

The core programming flow has a timezone bug, and it is the mirror of one the
history code was written to avoid.

1. `program/[athleteId].tsx:269` — `workoutDate` initialises to `new Date()`, so
   it carries the current **time of day**.
2. The picker is date-mode and preserves that time.
3. It sends `workoutDate.toISOString()` — converted to **UTC**.
4. `CreateWorkoutDto.date` is `@IsDateString()`, stored into a `date` column,
   truncated to the **UTC** day.

A coach in US Eastern programming at 9pm on 5 October, for 5 October, sends
`2026-10-06T01:00:00Z` and it is stored as **6 October**. Their own screen shows
5 October (`toLocaleDateString`). The athlete sees it on the wrong day. Nothing
errors.

The window is "after 8pm local" for Eastern — precisely when a coach sits down to
write next week.

`history-query.dto.ts` documents this hazard from the other direction: *"the
server's idea of today is UTC, so deriving it here would file an evening session
in the wrong day for anyone west of Greenwich."* The read path was made careful;
the write path was not. `POST /workouts/:id/assign` (#38) does it correctly and is
the model to copy.

**Fixed, both halves in one change** — which was the point. The client now sends
a date-only `YYYY-MM-DD` built from the picker's **local** calendar fields via
`toLocalDateString`, and the DTO is tightened to `@Matches(/^\d{4}-\d{2}-\d{2}$/)`
plus `@IsDateString({ strict: true })`, matching `before` and `AssignWorkoutDto.date`.

Tightening only the server would have converted a silent wrong-day into a 400 on
every workout creation; changing only the client would have left the hole open for
the next caller.

### 6. There is no password reset, and signup makes the lockout easy

No `resetPasswordForEmail`, no "forgot password" link, no recovery route anywhere.
Compounding it:

- **No confirm-password field**, so a typo at signup is silent.
- **No client-side validation** — the placeholder promises "At least 8 characters"
  and nothing enforces it; Supabase's own default minimum is 6.
- **Both screens show the same generic error** for everything. Supabase
  distinguishes `User already registered`, so a returning user who forgot they had
  an account is told their *password* is wrong and goes off guessing passwords
  instead of logging in.

Net effect: mistype your password at signup and your only recovery is a second
account on a different email.

**Note before scoping it:** `app.json` currently has **no `scheme`** — magic-link
auth was removed and nothing calls `makeRedirectUri` — so a reset deep link needs
that added back and the Supabase redirect allowlist updated. Not a one-hour job.

### 7. Workout templates cannot be created from the app at all

A workout is a template exactly when `athlete_id` is null. But the program screen
is only ever reached *for* an athlete and always sends a concrete id
(`handleCreateWorkout`, `program/[athleteId].tsx:686`) — there is no other create path. So
`GET /workouts/templates` is empty for everyone and always has been.

`onCreateWorkout` also takes an `isTemplate` flag that is **silently discarded** —
both call sites pass one, the handler declares three parameters, and TypeScript
accepts the narrower signature. Someone already tried to express this and the code
dropped it.

This blocked roadmap item 3, which was specified as "apply one template to N
athletes". #38 shipped instead as "assign this workout to these athletes", which
needs no template concept — so the *feature* is unblocked, but the template
surface is still dead code with a picker pointing at it.

**Decide:** either give templates a create path, or remove the template picker and
`GET /workouts/templates` so the app stops advertising a feature it does not have.
Same applies to `exercise_templates`, which has no producer either.

---

## 🟡 Correctness and data integrity

### 8. ~~A reject racing an accept leaves the athlete on the roster~~ — FIXED

`coach-requests.service.ts` → `respondToRequest` reads `request.status` **outside**
the transaction, then inside guards only the UPDATE with `where status = 'pending'`.
The INSERT is guarded by the **stale** `status` variable read earlier.

Two responses race; the reject commits first and flips the row to `rejected`; the
accept's UPDATE then matches **0 rows**, but its `status === 'accepted'` branch
still runs and inserts the relationship. Result: a request marked `rejected` with
an **active coach↔athlete relationship beside it** — the athlete declined and is
on the roster anyway.

**Fixed.** The UPDATE now `.returning()`s, and an empty result short-circuits the
transaction — so the compare-and-swap gates both writes rather than only the
first. Whoever answered first wins; the loser is dropped silently rather than
fighting over it.

Pinned by a test that was **verified to fail without the fix**, which for a race
matters more than usual: a test that only describes the sequence proves nothing.

### 9. ~~Duplicate pending invites are possible under a race~~ — FIXED

`createRequest` check-then-inserts: it selects for an existing `pending` row, then
inserts. Two concurrent invites for the same pair both pass. There is no unique
constraint to catch it — #31 put one on `coach_athlete_relationships` but
deliberately not on `coach_requests`, because re-inviting after a rejection is
legitimate.

**Fixed** with a partial unique index on `(athlete_id, coach_id) WHERE status =
'pending'`, plus a dedupe ahead of it so it can apply to a database that already
holds duplicates. The dedupe keeps the **oldest** pending row per pair — the
athlete has been looking at that invitation and their client holds its id, so
keeping the newer one would invalidate a notification they are about to tap.

The application check stays: it produces a far better message than a constraint
violation. The database is now what makes it *true*. A lost race is caught as
`23505` and reported as the same 400, so a caller cannot tell whether they lost a
race or simply asked twice — from their side those are the same thing.

Verified against local Postgres: re-inviting after a rejection is still allowed,
a second *pending* invitation for the same pair is refused.

### 10. Duplicate exercise names split an athlete's max

`exercises` has no uniqueness on `(created_by, name)` and `createExercise` inserts
without checking, so one coach's library can hold three rows called "Back Squat".

Harmless until #36. Now maxes key on `exercise_id`, so those three rows accumulate
**three separate squat maxes** for the same athlete doing the same lift, and
percentage prescriptions resolve against whichever duplicate the coach picked that
week.

The per-exercise decision (roadmap Q4) accepted fragmentation as a cost for
genuinely different *variations* — not for accidental duplicates of one.

**Fix:** a unique index on `(created_by, lower(name))`, preceded by a dedupe
migration exactly like the `coach_athlete_relationships` one in #31. Cheaper half:
surface existing matches in the exercise picker before offering "create new".

### 11. `actual_load` has no upper bound

`UpdateSetDto` bounds it at `Min(0)` with no ceiling. #36 stopped an implausible
value *propagating into a max*, but the logged set still stores 1000kg and history
still displays it as though it happened. Bounding the DTO is the root fix; #36 only
stopped the blast radius.

### 12. `GET /workouts?athlete_id=` is unbounded

`listAthleteWorkouts` has no limit and no date floor — every workout an athlete has
ever been assigned, forever.

`home.tsx` fetches the whole list on every app open, then filters and sorts
client-side to display **one** workout. Over a season that is hundreds of rows to
render a single card, on the screen users open most.

The two history routes were built with a proper envelope (`before`, `limit` capped
at 50, `has_more`) precisely because unbounded reads do not survive a season. This
route predates that and was never revisited.

**Fix:** the same envelope, or — better for the home screen — an endpoint returning
just the next scheduled workout, which is all the caller wants.

### 13. A coach↔athlete relationship cannot be ended

Nothing deletes from `coach_athlete_relationships` or moves it off `active`. Once
linked, permanently. On a university team that means a graduating coach keeps read
access to every athlete's training indefinitely — and #35 widened what that access
covers.

### 14. Set logging has no optimistic update, and it is the most frequent action

`workout/[workoutId].tsx:426` — `updateSetMutation` has only `onSuccess`, which
invalidates the whole workout. So every logged set costs a round trip **plus a full
refetch** before the UI moves, 20+ times a session, on gym wifi.

The tell is the inconsistency: `addExerciseMutation` directly below it **is**
optimistic with snapshot and rollback. Adding an exercise feels instant; logging a
set does not. The pattern to copy is in the same file.

---

## 🟢 Polish, and things worth knowing

### Auth guard (`common/validation/guards/auth-guard.ts`)

The local HS256 path is genuinely well built — rejects `alg: none`, compares with
`timingSafeEqual` behind a length check, requires non-empty `sub`, treats a
**missing** `exp` as invalid rather than "never expires", and reports every failure
identically. Three notes:

- **`iss` is never verified.** Standard defence, one comparison.
- **`aud` is only checked when present**, so a token with no audience claim passes.
  Supabase always sets one, which is an argument for rejecting its absence.
- **`verifyWithSupabase` double-wraps its own exception** — it throws
  `UnauthorizedException('Invalid token')` inside a `try` whose `catch` matches it
  and rethrows as `Token validation failed: Invalid token`. Cosmetic, fallback path
  only.

### Messaging

- `listConversations` runs **~6 correlated subqueries per row** — three separate
  `order by created_at desc limit 1` scans for the last message's content, time and
  sender where one lateral join would do, plus two re-executions of the `other`
  subquery. The #31 index makes each an index scan, so it is latency rather than a
  cliff — but it is the inbox, polled every 30s per signed-in user.
- `other_user_id` assumes exactly two participants (`limit 1`). The schema permits
  groups; if one appears the inbox picks an arbitrary "other".
- `unread_count` compares `created_at > last_read_at` — the timestamp tie/skew
  problem already written up in `REALTIME-MESSAGING-DESIGN.md` §5.
- `media_url` on `SendMessageDto` is a bare `@IsString()` with no `@MaxLength`, the
  one unbounded write on an otherwise carefully validated DTO.

### Set logging read check predates #35

`updateSet` tests `athleteId === callerId || coachId === callerId` — the *authoring*
coach only — where `loadReadableWorkout` now also admits any active coach. So a
co-coach gets a **404** on a set and a **403** on the workout containing it. Not a
leak (it is the more conservative answer) but the two paths disagree about the same
person, which is the drift #35 set out to remove.

### Image upload

- **`uploadAvatar(userId)` takes an id from the caller** and writes to
  `avatars/${userId}/…` with the anon key and `upsert: true`. Every other id
  parameter in `lib/api/*` was removed for this reason; this one survived because it
  builds a storage *path* rather than a row filter — and the path is not authorized
  by the API at all. **Whether it is exploitable depends entirely on the Supabase
  Storage policy on that bucket, which I cannot read from the repo.** If the bucket
  permits any authenticated user to write any key, a caller can overwrite another
  user's avatar. **Worth checking that policy before anything else in this section.**
- `contentType` is hardcoded to `image/jpeg` while the extension comes from the
  picked URI, so a PNG is stored announcing itself as a JPEG.

### Smaller things

- `MaxesService.refresh` issues one INSERT per exercise sequentially — an N+1, ~8
  round trips for a typical athlete. Fine at this scale; a single multi-row upsert
  would be one query.
- `MaxesService.setOverride` returns `const [view] = …` typed as `MaxView`. The row
  exists because the upsert just wrote it, but the type is a lie if the read ever
  comes back empty.
- The **"Week 1"** heading on the program screen (`program/[athleteId].tsx:202`) is
  hardcoded and bears no relationship to anything — it is wrong for every athlete
  past their first week.
- **No workout-level completion** — only `sets.is_completed`. No streak, no "done",
  no way to distinguish skipped from not-started. Item 7 aggregates sets to work
  around it; a column would be cheaper but needs a decision about what completion
  means when an athlete does three of four sets.
- **No coach profile view.** `coaches.biography` and `years_of_experience` are
  collected at signup and displayed nowhere; an athlete cannot see who their coach
  is. When built it must be a **list** — multiple coaches per athlete is supported.
- **No push notifications** (no `expo-notifications`), so nothing reaches a user
  whose app is closed. **No account deletion** anywhere.

---

## The repository is public

Worth stating plainly, because it changes how some of the above reads.

**The thing most important to get right is right.** The GitHub OIDC trust policy
(`infra/iam/github-oidc-trust-policy.json`) scopes `sub` to
`repo:chrrstiang/liftoff-app:ref:refs/heads/main` — not a wildcard. Its own comment
explains why: a bare `repo:…/*` would let any pull request, including one from a
fork, assume the deploy role and push to ECR.

**No credentials are committed.** Only `.env.example` is tracked, `.env` is
gitignored in all three places, and there are no hardcoded keys in source.

**What is public and is not a credential but is a map:** the AWS account ID, the
RDS endpoint hostname, subnet and security-group ids, Secrets Manager and SSM
ARNs, IAM role names, and the Supabase project URL, across `infra/` and
`deploy.yml`.

None grant access — RDS is `--no-publicly-accessible`, the ARNs name secrets
rather than containing them, and the Supabase URL ships in every app bundle. But
AWS advises treating an account ID as non-public, and collectively this saves an
attacker the enumeration step. Low priority; worth being a decision rather than a
default, especially if the repo is being shown to people.

---

## Clean results

Not everything checked was broken, and knowing which parts are sound is worth as
much as the list above.

- **Every route carries a guard.** All eight controllers, every route except
  `GET /` and `GET /health`, which are intentionally public. The class of bug that
  once shipped six unguarded routes on `CoachController` has not recurred.
- **No unscoped queries.** A scan for `.select()` / `.update()` / `.delete()` with
  no `.where()` found none.
- **No actor id from a request body.** The only DTO ids are `athlete_id` (a
  *target*, authorized against the token everywhere) and `exercise_id`.
- **Dead Tailwind classes, app-wide: 131 checked, 0 dead.** The design system is
  intact.
- **No hand-rolled `fetch` to the API.** The one `fetch` in the frontend reads a
  local file URI from the image picker.
- **`AuthContext` uses the API for profile data**, Supabase only for auth — the
  three documented Supabase jobs are accurate, there is no undocumented fourth.
- **Message input is properly bounded** (1–4000, enum-checked type), apart from
  `media_url`.
- **The roster invite flow's optimistic mutation is correct** — right cache key,
  cancel, snapshot and rollback, with the three previous bugs documented in place.

## Already documented on purpose — not re-reported

`docs/ARCHITECTURE.md` "Known limitations" records these deliberately and the root
`CLAUDE.md` asks that they not be changed as a side effect of other work: the
unregistered `validationExceptionFactory`; `athletes.team_id` never written; the
five unused database views; `@IsUnique` matching the caller's own row; the dead
`DIRECT_USER_REFERENCES` const; and the vestigial `supabase/` directory.

---

## Fixed during this run, not left open

Found while building #36–#39 and fixed there:

| | Where |
|---|---|
| `computed_from` FK had no delete rule — deleting a workout whose set produced a max would 500 | #36 |
| A mistyped `actual_load` could become a max and drive every future percentage | #36 |
| Exercise history returned an unresolved `prescribed_percent` — two response shapes for one row | #36 |
| Templates dropped their prescription (`prescribed_percent`, `suggested_load_*`) on both the server and client | #36, #37 |
| The maxes screen promised "pin one by hand" with no way to do it | #37 |
| The maxes screen rendered a failed read as "No maxes yet" | #37 |
| `MultiSelectSheet` wiped the staged selection on any re-render while open | #38 |
| `current_date - $1` — no type to infer, query failed at execution | #39 |

The last one is the one worth remembering: **the mocked Drizzle client never sends
SQL anywhere**, so it cannot catch a query that does not compile. Every mocked test
stayed green through it. It was found by running the real service against local
Postgres, which is now the pattern I would use for any non-trivial query.

---

## Method, and what this audit does not cover

**How things were checked:** reading every controller, service, DTO and screen;
scripted scans for unguarded routes, unscoped queries, body-supplied actor ids and
dead Tailwind classes; and executing queries against a local Postgres on port
55440 for anything the mocked test double structurally cannot verify.

**Not covered, and why:**

- **No e2e was run.** It mutates the shared live Supabase project, and its teardown
  sweeps by prefix. Everything added in #36–#39 is therefore **unit-tested only**,
  recorded as such in `docs/AUTHORIZATION.md`. The untested surface is the anon
  case on each new route and the real-database joins.
- **No simulator run.** Reaching the new screens needs a signed-in coach with a
  roster athlete against a backend holding Supabase credentials; a simulator would
  have reached a login screen. Visual verification of the new UI is genuinely
  outstanding.
- **The dead-class checker reads only plain string `className="…"`** — classes
  built in template literals or ternaries are not covered — and it compiles for
  **web**, so a `vh` unit passes here and is still ignored on device.
- **The Supabase Storage bucket policies could not be read from the repo**, which
  is why the `uploadAvatar` finding is conditional rather than confirmed.
- **Nothing was load-tested.** The performance findings are reasoning about query
  shape at 50 users, not measurements.
