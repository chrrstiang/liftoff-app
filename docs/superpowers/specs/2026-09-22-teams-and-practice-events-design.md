# Teams and Practice Events — Design

*Written 2026-09-22. Sub-projects A and B of the Practice Events & Organized Video
Review idea. Video submission and review is **not** in this spec.*

## What this is

A team is a named group of athletes and coaches. A practice event is a scheduled
session belonging to a team, with a participant list. This spec covers both, and
nothing else.

It exists because the feature it serves — a coach reviewing a session's lifting
videos in one place instead of scrolling WhatsApp — needs something for a video to
attach to. That anchor is an event, an event needs a team, and `teams` in this repo
is a two-column placeholder with no rows (`backend/src/db/schema.ts:92`).

## Scope

**In:** the `teams` entity and membership, team creation and roster management,
practice events including recurring series, per-event participants, cancellation,
and the calendar screens for both roles.

**Out, deliberately:**

- **Video submission, storage and the review surface.** Its own spec. It is where
  the genuinely novel work is — video files are ~100× the size of the images this
  app handles, and both existing Supabase buckets are world-readable by URL
  (`frontend/lib/api/storage.ts`), which is survivable for avatars and is not
  survivable for fifty athletes' lifting videos.
- **Auto-attaching the day's prescribed workout to an event.** Phase two in the
  original note, and still phase two.
- **Attendance and RSVP.** Not built here, but `event_participants` is the row it
  would live on, as a status column. This spec's job is to make sure that row
  exists.
- **Team leaderboards.** `docs/ROADMAP.md` open question 4 records that
  cross-athlete comparable lifts need a canonical movement catalogue nobody has
  designed. Modeling for it now would be modeling for an unsolved problem.
- **Push notifications** for a canceled practice. There is no `expo-notifications`
  dependency and adding one is not this spec.

## Position relative to the roadmap

`docs/ROADMAP.md` places "team as a real entity" **below the cutline**, after the
team migrates off Sheets. This work is above it, ahead of item 3 (bulk assign,
marked "next, the last adoption decider").

That is a deliberate, owner-made decision, recorded here rather than argued.
The supporting case: the roadmap's own test for what belongs above the line is
*"everything a coach does in a normal week,"* and this coach's team already runs
video review every week — informally, over WhatsApp. It is not a new workflow, it
is an unmanaged one.

The cost is real and worth naming: at 17:1, a coach still builds seventeen workouts
by hand until item 3 lands.

## Decisions

Eight decisions were settled before this was written. Each is recorded with its
rejected alternative, because the alternative is what a later reader will wonder
about.

| # | Decision | Rejected |
|---|---|---|
| 1 | Events belong to a **real team entity** | Coach-owned roster calendar, which would have left `teams` dead but given three co-coaches of one squad three separate calendars |
| 2 | A team is an **organizational grouping only** | Team-as-coaching-unit, which would have rewritten the #35 co-coach rules |
| 3 | One **`team_members`** table with a role | Reusing `athletes.team_id`; separate per-role join tables |
| 4 | A coach **adds athletes from their own roster**, no acceptance step | A second invite subsystem mirroring `coach_requests`; a shareable join code |
| 5 | Recurring series **materialize every occurrence up front**, end date required | Rolling horizon with a top-up job; rule-plus-exceptions with computed occurrences |
| 6 | **Participant rows**, pre-filled with the whole team | Default-all with exclusion rows; no invitee model |
| 7 | `timestamptz` + a team IANA timezone, occurrences generated in Postgres | Local date+time columns; naive UTC |
| 8 | Cancel is a **status**; membership removal is a real delete | Hard-delete both; soft-delete everything |

### Why decision 2 matters most

A team grants **nothing** except calendar scope and roster visibility.
Programming, messaging and roster authorization stay entirely on
`coach_athlete_relationships`. `backend/src/programming/service/programming-access.ts`
is not edited by this work, and the asymmetric read/write rules settled in #35 —
any active coach may read, only the authoring coach may change, only the athlete
records what was lifted — keep their current behavior and their pinning tests.

The new trust boundary is therefore confined to new tables. That is the whole
reason this option was chosen: in a codebase where the API is the entire trust
boundary and a mistake is a data breach rather than a bug, an additive boundary is
worth more than an elegant one.

### Why decision 5 matters most for the next spec

Videos will foreign-key to a single practice. A computed occurrence — "the
Wednesday of week 9, derived from a rule" — has no primary key, so the FK would
have to be a composite natural key like `(series_id, date)`, pushed into every
downstream table. Materializing occurrences gives a video a real `events.id` to
point at.

Sizing makes this cheap rather than a trade-off: three practices a week across a
sixteen-week semester is ~48 rows per team. Requiring an end date on a recurring
series removes the infinite horizon, which removes the top-up path, which removes
the need for scheduled-job infrastructure the backend does not have.

## Schema

New tables in `backend/src/db/schema.ts`, following the file's existing
conventions: `uuid` primary keys with `defaultRandom()`, `timestamp` with
`withTimezone: true`, indexes shaped from the queries that actually run rather
than one per column, and a doc comment on anything load-bearing.

### `teams` — gains meaning

The existing table keeps its `id` and `created_at` and gains:

| Column | Type | Notes |
|---|---|---|
| `name` | `text` NOT NULL | |
| `timezone` | `text` NOT NULL | IANA zone, e.g. `America/New_York`. No default — an implicit zone is how a 5pm practice becomes 4pm |
| `created_by` | `uuid` NOT NULL → `coaches.id` | References `coaches`, not `users`, matching `exercises.created_by` and `workouts.coach_id`. Only a coach may create a team |

`athletes.team_id` is **not** used and **not** dropped here. It stays dead. A
separate migration may drop it later; doing it in this one couples a schema
cleanup to a feature and makes the revert less obvious.

### `team_members`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `team_id` | `uuid` NOT NULL → `teams.id` | |
| `user_id` | `uuid` NOT NULL → `users.id` | `users`, not `athletes`/`coaches` — the role column carries which |
| `role` | `team_member_role` enum NOT NULL | `'coach'` \| `'athlete'` |
| `created_at` | `timestamptz` NOT NULL default now | |

Indexes:
- `uniqueIndex` on `(team_id, user_id)` — one row per person per team. A person
  cannot be both coach and athlete of the same team; see open question 1.
- `index` on `(user_id)` — "my teams" runs on every calendar load.
- `index` on `(team_id, role)` — "the team's athletes" and "the team's coaches" are
  both read constantly, and role is the filter.

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `team_id` | `uuid` NOT NULL → `teams.id` | |
| `series_id` | `uuid` nullable | Null for a one-off. Shared by every occurrence of a series. **Not** an FK — there is no `event_series` table, and inventing one to hold a single id would add a join to every read for no gain |
| `title` | `text` NOT NULL | |
| `starts_at` | `timestamptz` NOT NULL | |
| `ends_at` | `timestamptz` NOT NULL | Absolute end, not a duration. A duration would need the same timezone math applied twice |
| `location` | `text` nullable | |
| `notes` | `text` nullable | |
| `status` | `event_status` enum NOT NULL default `'scheduled'` | `'scheduled'` \| `'canceled'` |
| `created_by` | `uuid` NOT NULL → `coaches.id` | |
| `created_at` | `timestamptz` NOT NULL default now | |

Indexes:
- `index` on `(team_id, starts_at)` — the calendar filters by team and sorts by
  time, so one index serves both and Postgres skips the sort. Same reasoning as
  `workouts_athlete_id_date_idx`.
- `index` on `(series_id)` — "edit all future events" filters on it.

`ends_at > starts_at` is enforced in the DTO, not as a check constraint, matching
how the rest of the schema leaves value rules to `class-validator`.

### `event_participants`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `event_id` | `uuid` NOT NULL → `events.id` | |
| `user_id` | `uuid` NOT NULL → `users.id` | |
| `created_at` | `timestamptz` NOT NULL default now | |

Indexes:
- `uniqueIndex` on `(event_id, user_id)`
- `index` on `(user_id, event_id)` — "my upcoming practices" starts from the user

No `status` column yet. Attendance is out of scope, and a column nothing writes is
worse than a migration later.

**Participant rows outlive membership.** Removing someone from a team deletes
their `team_members` row and leaves `event_participants` alone. Those rows are a
record that a person was at a practice — training history, not membership — and
the video spec will hang submissions off them.

### Migration

One Drizzle migration via `npm run db:generate`, which will be `0004_*.sql`.

No data migration and no backfill: every table is new and starts empty. Nothing
reads `teams` today, so there are no existing rows to reconcile.

## Recurrence generation

A coach creating a series posts a rule; the API expands it to rows. The expansion
is a **pure TypeScript function** in `backend/src/teams/service/recurrence.ts`,
with no dependency added.

**Revised 2026-09-22, during planning.** This spec originally put the expansion in
Postgres (`generate_series` + `AT TIME ZONE`), reasoning that the backend has no
date library (`backend/package.json`) and `CLAUDE.md` forbids adding dependencies
without asking. Postgres would have been correct, but it is **not unit-testable
here**: `backend/src/db/testing/db-mock.ts` ignores `where` and every other clause
by design, so no unit test can observe generated SQL. The DST test would exist only
in e2e — which feature-branch pushes skip and which skips itself when the Supabase
secrets or auth health probe are unavailable. A silent one-hour shift halfway
through a semester is precisely the bug that needs a gate that always runs.

A pure function needs no dependency either. Node 20 ships full ICU, so
`Intl.DateTimeFormat` with a `timeZone` yields correct zone offsets, including
across DST transitions. This also matches the repo's own precedent:
`programming/service/e1rm.ts` is a pure domain module with `e1rm.spec.ts` beside
it, and `maxes.service.ts` consumes it.

### The interface

```ts
export interface RecurrenceRule {
  /** 0 = Sunday .. 6 = Saturday. At least one, at most seven. */
  weekdays: number[];
  /** Local wall-clock start, "HH:MM" in the team's zone. */
  startTime: string;
  /** Minutes. Applied to the local start, so an event never straddles a DST
   * change with a wrong duration. */
  durationMinutes: number;
  /** Inclusive, "YYYY-MM-DD" local dates. */
  startDate: string;
  endDate: string;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

export function expandSeries(rule: RecurrenceRule, timeZone: string): Occurrence[];
```

Local dates are walked by **calendar-field arithmetic**, never by adding
86,400,000 ms, and each local wall time is converted to an instant independently.
That is what keeps a 17:00 practice at 17:00 across a transition rather than
drifting to 16:00.

### Bounds, enforced in the DTO

Not discovered in production:

- an end date is **required** for a recurring series
- the span may not exceed **52 weeks**
- the expansion may not exceed **500 occurrences** — a fat-fingered daily series
  across five years is otherwise one request that writes a hundred thousand rows
- all occurrences are inserted in **one transaction** with their participant rows

## Authorization

⚠️ There is no RLS. Every rule below is the entire authorization for the
operation.

All of it lives in **one file**, `backend/src/teams/service/team-access.ts`,
modeled directly on `programming-access.ts` — same single-joined-query discipline,
same doc-comment-per-rule, same 404-over-403 default.

### Helpers

```
loadMembership(db, teamId, userId): Promise<TeamRole | null>
assertReadableTeam(db, teamId, callerId): Promise<TeamRole>    // 404 if not a member
assertManageableTeam(db, teamId, callerId): Promise<void>      // 403 if athlete member
loadReadableEvent(db, eventId, callerId): Promise<EventOwners>
loadManageableEvent(db, eventId, callerId): Promise<EventOwners>
```

`loadMembership` returns the caller's role or null in **one** query rather than
exposing separate `isTeamMember` / `isTeamCoach` predicates. Two predicates would
mean two round trips for every write, and — more importantly — two chances to
check the wrong one. The single-query discipline is the same reason
`loadSetOwners` joins rather than walking `sets → workout_exercises → workouts` in
three lookups: one query cannot be half-authorized.

Membership is a `(team_id, user_id)` lookup — a **pair**, exactly like
`isActiveCoachOf`. Every coach of a team passes independently, so multiple coaches
per team works with no "head coach" concept.

### Rules

| Action | Who |
|---|---|
| Create a team | any user with a `coaches` row |
| Read a team, its roster, its events | any member of that team, coach or athlete |
| Add or remove members | any **coach** of that team |
| Create, edit, cancel, delete an event | any **coach** of that team |
| Edit the participant list | any **coach** of that team |
| Read an event | any member of the event's team — **not** only its participants |

Two consequences worth stating explicitly:

**Any team coach may edit any team event, including one another coach created.**
This is the opposite of the workout rule, where only the authoring coach may
change. The asymmetry is intentional: a shared practice calendar that only its
author can fix is worse than a Google Calendar, and the blast radius of moving a
practice is a confused athlete, not a destroyed training record. `created_by` is
retained for display and attribution.

**A coach may only add athletes they actively coach.** `POST /teams/:id/members`
checks `isActiveCoachOf(db, callerId, athleteId)` — reused from
`programming-access.ts`, not reimplemented — and rejects otherwise. This is what
substitutes for an acceptance step: consent happened when the athlete accepted
that coach. It also means nobody can be added to a team by a stranger.

With co-coaches, each coach contributes their own athletes; a second coach joins
the team and brings theirs. A coach adding *another coach* to a team is allowed
with no relationship check, since coaches have no pairwise relationship to check.

### Status codes

404-over-403 where the caller has no claim: a non-member asking for a team or an
event gets a 404 naming the id, never a 403. Team and event ids would otherwise
answer "does this team exist and who is in it" for any id a caller tries.

403 is used in exactly one place: a caller who **is** a team member but not a
coach, attempting a write. They can already see the team, so the 403 discloses
nothing and is the more useful answer — "this is not yours to change" rather than
"this does not exist." This mirrors the reasoning already recorded for
`loadProgrammableWorkout`.

`docs/AUTHORIZATION.md` gains a `### teams / events` section under "The matrix",
citing the enforcing function and the test pinning each rule, in the format the
existing sections use.

## API surface

New module `backend/src/teams/`, laid out like `programming/`: two controllers and
two services behind one access file.

```
backend/src/teams/
├── teams.module.ts
├── controller/teams.controller.ts
├── controller/events.controller.ts
├── service/teams.service.ts
├── service/events.service.ts
├── service/team-access.ts
└── dto/{create-team,team-members,create-event,update-event,event-query}.dto.ts
```

`teams.module.ts` imports `SupabaseModule`, for the same reason
`ProgrammingModule` does: `JwtAuthGuard` needs it. No data here touches Supabase.

### Teams

| Method | Route | Notes |
|---|---|---|
| `POST` | `/teams` | Creates the team and the caller's own `team_members` row with `role: 'coach'`, in one transaction. Caller comes from the token; **never** from the body |
| `GET` | `/teams` | The caller's teams, both roles |
| `GET` | `/teams/:teamId` | Team plus full member list — every member, both roles, per decision on athlete reads |
| `PATCH` | `/teams/:teamId` | `name`, `timezone`. Coach only |
| `POST` | `/teams/:teamId/members` | Body `{ user_id, role }`. Athlete adds require `isActiveCoachOf` |
| `DELETE` | `/teams/:teamId/members/:userId` | Coach only. Deletes the membership row; leaves `event_participants` |

No `DELETE /teams`. Deleting a team with events and participant rows is a cascade
decision nobody needs yet, and `docs/ROADMAP.md` already records "no way to end a
relationship" as a hole — better to leave it visibly absent than half-built.

### Events

| Method | Route | Notes |
|---|---|---|
| `POST` | `/events` | One-off or a series. `recurrence` present → expands to N rows sharing a `series_id`, plus participant rows for every current team athlete, in one transaction. Response returns the created occurrences |
| `GET` | `/events` | `?team_id=` required, `?from=` / `?to=` window required. Returns scheduled **and** canceled events — the client renders canceled differently |
| `GET` | `/events/:eventId` | Event plus participants |
| `PATCH` | `/events/:eventId` | `?scope=this` (default) or `?scope=future`. `future` updates every event in the series with `starts_at >= this one`. Coach only |
| `POST` | `/events/:eventId/cancel` | Sets `status: 'canceled'`. A distinct route rather than a PATCH field, so cancellation is one auditable call and cannot be a side effect of editing a title |
| `POST` | `/events/:eventId/participants` | Body `{ user_id }`. Must be a team athlete |
| `DELETE` | `/events/:eventId/participants/:userId` | |

`GET /events` **requires** a date window. An unbounded read of a team's whole
history is not a screen anyone is building, and making it impossible is cheaper
than making it fast.

`?scope=future` is the standard calendar affordance and covers the note's open
question about editing a series. `scope=all` is deliberately omitted: editing a
practice that already happened rewrites history, and no UI asks for it.

Errors keep the one shape every endpoint uses:
`{ statusCode, message, timestamp, path, method }`.

## Frontend

Conventions differ per package. This side: **double quotes, `@/...` imports
exclusively, TS `strict` on, no Prettier**, per the table in `CLAUDE.md`.

### New files

```
frontend/lib/api/teams.ts       through @/lib/api/client, like the other nine
frontend/lib/api/events.ts
frontend/types/team.ts
frontend/types/event.ts
frontend/app/(app)/(tabs)/calendar.tsx      the calendar, both roles
frontend/app/(app)/teams/[teamId].tsx       roster management
frontend/app/(app)/events/[eventId].tsx     event detail
frontend/app/(app)/events/new.tsx           create, coach only
```

`lib/api/*` grows from nine modules to eleven. `CLAUDE.md`'s count in the data-path
section needs updating; it has already been updated once for `maxes`.

### Tabs

`(tabs)/_layout.tsx` gains a Calendar tab between Messages and Program/Roster,
with a `lucide-react-native` icon (`CalendarDays`). **Ungated** — both roles get
it, which keeps each role at five tabs.

Set `screenOptions` on the navigator, not per screen; the existing comment in that
file explains why and it applies to the new tab.

### Behavior

- Server state through **TanStack Query**, already the project's answer. No new
  dependencies.
- The calendar renders **in the device's timezone**. For a co-located university
  team that is the team's zone, so no timezone library is needed on the client
  either. If the device zone differs from `teams.timezone`, show the team zone as
  a label rather than converting — a wrong silent conversion is worse than an
  explicit one.
- A canceled event stays in the list, struck through and labeled, never removed.
  An event that vanishes is indistinguishable from a bug.
- No polling. `lib/api/polling.ts` exists for messages, where five seconds
  matters; a practice calendar changes a few times a semester. Refetch on focus.
- An athlete with no team sees an empty state explaining a coach adds them. An
  athlete cannot create a team.

### The verification trap

⚠️ **Nothing in CI catches a dead Tailwind class**, which is how this app shipped
for months with light mode unimplemented. Every new screen needs both `bg-canvas`
and `dark:bg-canvas-dark`-style pairs, verified by eye in both modes. Follow the
verification section in `frontend/CLAUDE.md`. Type-check and lint passing means
nothing here.

## Testing

Backend has Jest (unit + e2e); frontend has no tests, and this spec does not add a
test framework to it.

### Unit — the ones that matter

`backend/src/teams/service/team-access.spec.ts`, modeled on
`programming-access.spec.ts`, which pins rules by compiling them to SQL:

- a non-member gets 404, not 403, from every read
- a team athlete gets 403, not 404, from every write
- `loadMembership` returns `'coach'` for each of two coaches on the same team, independently
- adding an athlete the caller does not coach is rejected
- removing a member leaves `event_participants` intact

`backend/src/teams/service/recurrence.spec.ts` — a pure-function spec, beside the
module, exactly as `e1rm.spec.ts` sits beside `e1rm.ts`:

- a weekly series across a **DST boundary** keeps its local wall time — the single
  most important test in this spec, and the one whose absence would ship a silent
  bug halfway through a semester
- a series spanning no DST change produces evenly spaced instants
- multiple weekdays come back in chronological order
- an expansion over the 500-occurrence cap throws rather than returning a huge list

`backend/src/teams/service/events.service.spec.ts`:

- `scope=future` updates only occurrences at or after the target
- creating a series writes participant rows for every current team athlete, in one
  transaction — asserted through the mock's `writes` and `transactions` fields
- cancelling sets status rather than deleting, asserted through `writes`

DTO specs, following `history-query.dto.spec.ts`:

- `ends_at <= starts_at` is rejected
- a recurring series with no end date is rejected
- a span beyond 52 weeks is rejected

### E2E

`backend/test/teams/teams.e2e-spec.ts`, following
`test/programming/programming.e2e-spec.ts` and reusing `test/helpers/fixtures.ts`.
New rows must be registered with `test/helpers/sweep.ts` or they leak between runs.

⚠️ **A green `backend-e2e` job does not mean e2e passed.** The job skips its
remaining steps with a workflow warning when `SUPABASE_PROJECT_URL` /
`SUPABASE_SECRET_KEY` are missing or the auth health probe fails. Look for the
"E2E skipped" warning before trusting the check. Feature-branch pushes skip e2e
entirely, so breakage first surfaces at PR time.

### Gates

`/ci-check` reproduces them. Backend: `npm run lint`, `npx tsc --noEmit`,
`npm run build`, `npm test`. Frontend: `npm run lint`, `npm run type-check`.
Remember `cd frontend` or `cd backend` first — nothing runs from the root.

## What the next spec inherits

For sub-project C (video submission and review):

- a real `events.id` to foreign-key against
- `event_participants` as the natural home for a submission's owner
- `team-access.ts` already answering "may this user see this event"
- an unanswered question it must own: **videos need private storage.** Both
  existing buckets are world-readable by URL. That spec decides signed URLs from
  the backend versus a new bucket policy, and it should not proxy binary through
  Fargate

## Open questions

1. **Can one person be both coach and athlete of the same team?** A
   player-coach is real in university lifting, and `users.is_athlete` /
   `users.is_coach` are independent booleans rather than exclusive — so the app
   already permits the person. The unique index on `(team_id, user_id)` forbids
   the *pair of rows*, which answers this by accident rather than on purpose.
   **Recommended: leave it forbidden for now**, and if it comes up, change `role`
   to a pair of booleans rather than relaxing the index.
2. **What happens to an athlete's future `event_participants` rows when they leave
   a team?** This spec leaves them, which means a departed athlete stays listed on
   next Wednesday's practice. Deleting future rows while keeping past ones is
   probably right, but it needs a definition of "past" and it is not blocking.
3. **Does `teams.timezone` belong on the team or the event?** On the team here,
   which is correct for a squad that trains in one gym and wrong for a team with a
   satellite location. Revisit only if that happens.
4. **Does this answer `docs/ROADMAP.md` open question 3 ("what is a `team`?")?**
   Partly — it answers "a roster grouping with a calendar" and explicitly declines
   the leaderboard-scope and federation-affiliation readings. That question should
   be updated rather than closed.
