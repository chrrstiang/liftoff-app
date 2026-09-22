# Roadmap

**Status: a plan, not a description of working software.** Drafted 2026-09-13 from an audit
of every controller, route and table. Where this document says a thing does not exist, that
was verified by reading the code — but it ages, so re-check before trusting a row.

Companion documents: `ARCHITECTURE.md` (how the built parts work), `AUTHORIZATION.md` (who
may reach what), `REALTIME-MESSAGING-DESIGN.md` (a design, also unbuilt).

**State of play, 2026-09-20.** Three of the seven items in the cutline (§5) have been built
since this was drafted. The holes in §3 are kept as written, each annotated with what closed
it, because the reasoning is why the work was worth doing — not because the hole is still open.

| Item | State |
|---|---|
| 1 · Indexes + unique constraint | **merged** (#31) |
| 4 · Workout and exercise history | **merged** (#33) |
| 6 · Profile editing | **merged** (#32) |
| — · Co-coach read visibility | **merged** (#35) — see open question 6 |
| **2+5** · Maxes + percentage prescription | backend **merged** (#36); UI in review — see `MAXES-DESIGN.md` |
| 3 · Bulk assign | not started — **next**, the last adoption decider |

| 7 · Adherence view | not started |

---

## 1. Context

The target users are a university powerlifting team: **~50 lifters, 3 active coaches**, a
~17:1 athlete-to-coach ratio. The coaches currently program in **Google Sheets**.

Two consequences drive everything below.

**The ratio makes bulk programming the adoption bottleneck.** A coach who must build 17
workouts by hand each week will not switch, no matter how good the athlete experience is.

**Switching costs mean there is a cutline, not a sequence.** A coach moving 17 athletes off
Sheets pays a real one-time cost. At 80% complete they do not get 80% of the value — they get
zero, because they run Sheets *and* LiftOff in parallel and quit in week two. So the plan is:
build to a minimum coherent set privately, migrate the whole team at a training-block
boundary, then iterate in public.

"Complete" is unbounded and a solo developer chasing it never ships, so it needs a definition
tight enough to finish:

> **Complete = everything a coach does in a normal week in Sheets, plus the one thing Sheets
> cannot do.**

Anything outside a normal week is below the line, however good an idea it is.

---

## 2. What is built and usable

Verified by reading the screens and the controllers, not by assuming.

| Feature | Code | Notes |
|---|---|---|
| Auth | `(auth)/login.tsx`, `signup.tsx`, `app/_layout.tsx` | Password + magic link, session restore, profile-completion gate |
| Profile creation | `(app)/create-profile.tsx` (430 lines) | Federation / division / weight class; athlete and coach are independent booleans, not exclusive |
| Coach↔athlete invites | `coaching/controller/coach-requests.controller.ts` | Search, invite, accept/reject; the relationship row is created server-side in a transaction |
| Coach roster | `(tabs)/roster/roster.tsx` (338 lines) | FlatList, fine at 50 |
| Program building | `(tabs)/program/[athleteId].tsx` (596 lines) | Workouts, exercises, prescribed sets; templates derived from `athlete_id IS NULL` |
| Workout logging | `(app)/workout/[workoutId].tsx` (527 lines) | Actual load / reps / intensity, per-set `is_completed` |
| Messaging | `messaging/controller/conversations.controller.ts` + thread screen (376 lines) | Send, image attachments, unread counts, read watermark. Polling at 5s / 30s |

Role-gated navigation via `<Tabs.Protected>` in `(tabs)/_layout.tsx` already works and is
keyed on `profile.is_athlete` / `profile.is_coach`.

---

## 3. Holes

### 3.1 The one that loses to a spreadsheet

**There is no 1RM, training max or e1RM anywhere in the system.** The only `max_weight` in the
codebase is `weight_classes.max_weight` (`schema.ts:119`) — the upper bound of a weight class,
unrelated to strength. `prescribed_intensity` is free-form `text` (`schema.ts:302`), so nothing
computes with it.

A coach programming in LiftOff must therefore type `suggested_load_min` / `suggested_load_max`
as **absolute numbers, per set, per athlete, 17 times over**. In Sheets they write `=0.75*$B$2`
once and fill right.

**For a percentage-based sport, the tool is currently strictly worse than the thing it
replaces.** This is not a polish gap; it is the reason adoption would fail.

The leapfrog is already in reach: `sets` stores `actual_load`, `prescribed_reps` and
`actual_intensity` on every logged set, so an e1RM (Epley/Brzycki) can be computed from work
actually done and the training max can **update itself**. A spreadsheet structurally cannot do
that — it has no idea what the athlete actually lifted.

> **In review.** See `MAXES-DESIGN.md`. **Items 2 and 5 turned out to be one feature**, not
> two: maxes are per-*variation* (a tempo squat at RPE 7 is not a comp squat at RPE 7), which
> means roughly eight numbers per athlete — unmaintainable by hand at 17 athletes. What makes
> per-variation maxes tractable is deriving them, so shipping item 2 without item 5 would have
> delivered the burden without the relief.

### 3.2 Data disappears the day after it is logged

`(tabs)/home.tsx` filters `workoutDate >= startOfToday()`, so it only ever shows the *next*
workout. There is no past-workouts screen and no exercise-history endpoint. Every completed
workout becomes invisible the following day.

Nothing answers *"what did I squat last week?"* — the single most-used query in any lifting
app, and a hard requirement for a coach programming the next block. The data is all there.

> **In review (#33).** `GET /workouts/history` and `GET /exercises/:id/history`, both
> paginated, plus a history screen and a "Last time" sheet over the logging screen. Exercise
> history paginates over *sessions* rather than sets, so a page boundary cannot cut a session
> in half and render a 5-set day as a 3-set one.

### 3.3 Performance: the database has no indexes

Neither `0000_sharp_aaron_stack.sql` nor `0001_create_views.sql` contains a single
`CREATE INDEX`. The only non-primary-key constraint in the schema is `users.username`
(`schema.ts:76`).

**Postgres does not automatically index foreign keys.** Every lookup on
`sets.workout_exercise_id`, `workout_exercises.workout_id`, `messages.conversation_id` and
`coach_athlete_relationships.athlete_id` is a sequential scan. Fine at three users; at 50
lifters across a season, on a `db.t4g.micro`, it will be visibly slow.

Roughly an hour of work, and the highest value-per-effort item in this document.

> **Fixed in #31.** Seventeen indexes, shaped from the queries that actually run rather than
> one per column — `messages (conversation_id, created_at)`, `sets (workout_exercise_id,
> set_number)`, `workout_exercises (workout_id, "order")`, `workouts (athlete_id, date)` and
> `(coach_id, created_at)` — so filter and sort are served together and Postgres skips the sort.

### 3.4 Integrity and cardinality

- ~~**No unique constraint on `(athlete_id, coach_id)`**~~ — **fixed in #31.** Nothing at the
  database level prevented duplicate relationships, and with 3 coaches re-inviting across 50
  athletes it would have happened. The migration deduplicates before adding the index, because
  it could not otherwise apply to a database already holding a duplicate — and the `ORDER BY`
  prefers `status = 'active'` over `'pending'` rather than keeping the oldest row, since
  ordering by `created_at` alone could delete the active row and silently unlink a coach from
  an athlete who is actually training with them.
- **Multiple coaches per athlete is supported — decided 2026-09-17.** The schema always allowed
  it, and an audit of the code found nothing that assumes a single coach:
  `isActiveCoachOf(db, coachId, athleteId)` is a *pair* existence check, so each coach passes
  independently; `coach_athletes_view` selects per-relationship rows and so naturally returns
  several; and `coach_id` was deliberately removed from the athlete profile shape
  (`frontend/lib/api/athlete.ts` returns `Omit<AthleteProfileView, "coach_id">`), so nothing
  holds a singular "my coach". The unique index added in item 1 is on the **pair**, which
  encodes exactly this decision.

  **What it does change:** the coach profile view (3.5) does not exist yet, and when it is built
  it must be a *list* from the start. Retrofitting a singular screen is the expensive version.

  **And it opens a new question** — see open question 6.

### 3.5 Smaller gaps, roughly by how much they hurt

| Gap | Detail |
|---|---|
| ~~Profile is read-only except the avatar~~ — **in review (#32)** | `PATCH /users/profile` existed and worked; `(tabs)/profile.tsx` never called it. #32 adds an edit screen and a new `PATCH /athlete/profile`, since federation/division/weight class had no update path at all |
| No coach profile view | `coaches.biography` and `years_of_experience` are collected at signup and displayed nowhere. An athlete cannot see who their coach is |
| No workout-level completion | Only per-set `is_completed`. No "done", no streak, no adherence metric for the coach |
| No way to end a relationship | `coach_athlete_relationships` has no delete path. Connections are permanent |
| "Notifications" are only coach requests | `lib/api/notifications.ts` wraps `/coach-requests`. There is no `expo-notifications` dependency, so nothing reaches a user whose app is closed |
| `teams` is dead | Zero references outside `schema.ts:88`, where the comment already calls it a placeholder |
| Reference data bypasses the API — **now on two screens** | `create-profile.tsx` reads `federations` / `divisions` / `weight_classes` straight from Supabase with the anon key. Public data, so nothing is exposed, but it is the one exception to "everything goes through the API". #32 extended it to a second screen via `frontend/lib/reference.ts`. See open question 7 |

### 3.6 Absent entirely

The **social layer** — feed, communities, leaderboards, meet recaps. No tables, no endpoints,
no screens. The root `README.md` pitches it.

---

## 4. A constraint worth knowing before planning anything

The schema is **committed to a coach-centric model**, and two columns enforce it:

```
workouts.coach_id      NOT NULL  -> coaches.id     (schema.ts:265)
workouts.athlete_id    nullable  -> athletes.id    (schema.ts:264)
exercises.created_by   NOT NULL  -> coaches.id     (schema.ts:222)
```

A workout **cannot exist without a coach** but can exist without an athlete. A user with no
`coaches` row cannot author an exercise. Every row of training data hangs off
`workout_exercises -> workouts -> coaches`.

So a solo lifter with no coach cannot log training at all. That is the correct shape for the
coaching product and the wrong shape for a general training log or a social network — both of
which would need migrations touching the most-referenced tables in the codebase (`sets`,
`workouts`, `exercises`). **This is not a neutral schema; pivoting away from coaching is
expensive, and that should be a deliberate decision rather than a discovery.**

---

## 5. The cutline

### Above — the migration set

Ordered. Items 1-3 are the difference between "the coaches tried it and went back to Sheets"
and "the coaches stayed."

1. ✅ **Indexes, plus the `(athlete_id, coach_id)` unique constraint.** Merged (#31). See 3.3, 3.4.
2. 🔄 **A stored max per athlete per exercise, and percentage-based prescription.** Backend in
   review. **Merged with item 5** — see 3.1 and `MAXES-DESIGN.md`. The price of entry against
   Sheets.
3. ⬅️ **Bulk assign: one template to N athletes.** **Next.** Templates already exist — `is_template` is
   derived from `athlete_id === null` at `workouts.service.ts:296` — but nothing applies one to
   a group. This is what makes 17:1 survivable.
4. 🔄 **Workout and exercise history.** In review (#33). Required for coaching, and it feeds
   item 5. See 3.2.
5. 🔄 **Auto-updating training max from logged sets.** The leapfrog; the one thing Sheets
   cannot do. **Merged into item 2** — they are the same feature.
6. 🔄 **Profile editing.** In review (#32). Needed a new `PATCH /athlete/profile` after all —
   the athlete columns had no update path. See 3.5.
7. **Coach-side adherence view** — who actually did the work. The coach's reason to open the app
   on a day they are not programming.

### Below — after migration

- Team as a real entity, then a team leaderboard. This is the social layer, and at 50
  co-located users who already know each other it will actually work — unlike a global feed.
- Meet prep and attempt selection. `federations`, `divisions`, `weight_classes` and
  prescribed-vs-actual intensity are already modeled, and no general fitness app does this.
  This is where LiftOff stops being a TrueCoach clone.
- WebSocket messaging, read receipts, edit/unsend — see `REALTIME-MESSAGING-DESIGN.md`.
- Push notifications.

**On messaging specifically:** it is genuinely below the line. `THREAD_POLL_MS` is 5 seconds,
and no coach has ever abandoned a tool because a message took five seconds to arrive. If the
e1RM work and the WebSocket work compete for the same weekend, e1RM wins.

---

## 6. Open questions

1. **When is the next training-block or semester boundary?** Migration should happen at one,
   not mid-block. Still no date — but **answered in the loose sense on 2026-09-20: months,
   not weeks.**

   That is the scoping answer that matters most, and it changes the plan: there is room to
   build item 2 properly rather than cutting corners, to fix the `create-profile.tsx` bugs
   alongside question 7, and to let item 5 wait for items 2 and 4 instead of racing them.
   A date would still be better than "months" — it is what turns a sequence into a schedule —
   so it stays open.

2. ~~**Can an athlete have more than one coach?**~~ **Answered 2026-09-17: yes.** See 3.4. The
   unique index in item 1 is on `(athlete_id, coach_id)` rather than `athlete_id` alone, which
   permits distinct coaches while still rejecting a duplicate pair.
3. **What is a `team`?** A roster grouping, a leaderboard scope, a federation affiliation, or
   all three. The table exists and is empty of both rows and meaning.
4. ~~**Per-lift max, or per-exercise max?**~~ **Answered 2026-09-22: per-exercise.** A parent-lift
   model is not a simplification of the domain, it is a misreading of it — each variation has its
   own difficulty and therefore its own max. A tempo squat at RPE 7 might be 130kg where a comp
   squat at RPE 7 is 170kg, so resolving tempo work against a comp squat max hands the athlete a
   number wrong by 40kg.

   **The accepted cost:** `exercises.created_by` is NOT NULL, so libraries are per-coach and a
   coach change leaves the new coach's rows with no history and no derived max. Rare, carried
   across by an override, and the alternative was designing a canonical movement catalogue before
   anyone knows which variations actually get programmed. Revisit when a coach leaves, or when
   team leaderboards need lifts comparable across athletes.

5. ~~**Does the coach set the training max, or does the app?**~~ **Answered 2026-09-22: both —
   derived, with the coach able to pin an override.** The override is a *pin, not a seed*: it wins
   until cleared, so a coach who knows the athlete's comp squat is 180 is not overruled by one
   cautious session. Derivation is coach-triggered rather than automatic; a max that moved on
   every logged set would re-scale Wednesday's squats because Monday was strong.

6. ~~**Can co-coaches see each other's programming for a shared athlete?**~~
   **Answered 2026-09-20: yes for reads, no for writes.**

   The rule is asymmetric, and the asymmetry is deliberate:

   | Action | Who |
   |---|---|
   | **Read** an athlete's sessions | the athlete, and any active coach of them, whoever authored it |
   | **Change** a workout's structure | the authoring coach only |
   | **Record what was lifted** | the athlete only |

   Reading another coach's programming is coordination — and three coaches sharing a Google
   Sheet had it for free, so withholding it made the app worse than the tool it replaces.
   That is what promoted this above the cutline despite being filed below it. Silently
   rewriting or deleting another coach's work is not coordination and has a far larger blast
   radius, so writes did not move.

   Resolved the disagreement noted here previously: `GET /workouts?athlete_id=` never applied
   the filter, and now does not need to. See `AUTHORIZATION.md`.

7. **Should reference data move behind the API? — yes, but triggered rather than queued.**

   `federations` / `divisions` / `weight_classes` are read straight from Supabase with the
   anon key, in six calls across `frontend/lib/reference.ts` and `create-profile.tsx`. Those
   six are **every** `supabase.from()` in the app; migrating them means the client makes zero
   Supabase table reads, permanently. Supabase keeps auth and the image buckets — those are
   not tables.

   **The real argument is a latent bug, not tidiness.** The pickers read the *Supabase* copy
   of this data; `backend/src/users/service/reference-validation.ts` validates submissions
   against the *RDS* copy. Nothing keeps them in sync. Add a weight class, reseed, or fix a
   typo in a division name and the picker offers an option the API rejects with a 400, on the
   one screen every new user must complete. This is invisible until someone edits reference
   data — which makes it exactly the kind of thing that surfaces during a migration week.

   Two smaller gains: these six calls throw raw Supabase errors rather than the
   `{ statusCode, message, timestamp, path, method }` envelope every other call uses; and once
   nothing reads tables, the anon role's table access can be **revoked outright**, turning
   "safe as long as RLS is configured correctly" into a structural guarantee. (The anon key
   itself stays in the bundle regardless — auth needs it.)

   **It is below the cutline and should stay there.** It does nothing for a coach handling 17
   athletes. So it is triggered, not queued:

   - **Do it the next time anyone opens `create-profile.tsx`.** That screen also carries two
     known bugs — the gender list offers "Other", which 400s against the enum, and
     date-of-birth initialises to `new Date()` so a user can submit today as their birthday.
     One PR fixes the data path and both bugs together.
   - **Or immediately, if reference data is going to be edited before the team migrates.**
     That is the scenario the drift bug is waiting for.

   Shape: three reads behind `JwtAuthGuard` (profile creation runs before the `users` row
   exists, but the caller is authenticated, so the guard is fine), or one `GET /reference`
   returning all ~59 rows. Then point both screens at it. **Do not drop the Supabase tables in
   the same PR** — stop reading them first, verify, then revoke access as a separate commit so
   the revert is obvious if something outside this repo still reads them.

8. **When does the coach profile view get built, and as a list?** §3.4 — multiple coaches per
   athlete is supported, so the screen that does not exist yet must be plural from day one.
   Retrofitting a singular screen is the expensive version.
