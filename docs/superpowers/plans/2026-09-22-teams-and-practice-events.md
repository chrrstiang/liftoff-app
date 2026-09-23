# Teams and Practice Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a team a shared calendar of practice events, so a later spec can attach lifting videos to a specific practice.

**Architecture:** One new NestJS module `backend/src/teams/` holding two controllers (teams, events) behind a single authorization file `team-access.ts`, structurally identical to how `backend/src/programming/` is laid out. Recurring series are expanded to one row per occurrence by a pure TypeScript function so the DST behavior is unit-testable. Frontend gets a Calendar tab plus three stack screens, all reading through `@/lib/api/*` like the existing nine modules.

**Tech Stack:** NestJS 11, Drizzle ORM on Postgres, Jest (unit + e2e), Expo / React Native with expo-router, TanStack Query, NativeWind.

**Spec:** `docs/superpowers/specs/2026-09-22-teams-and-practice-events-design.md` — read it before Task 1. It records eight decisions with their rejected alternatives; this plan implements them and does not re-litigate them.

## Global Constraints

- **`cd frontend` or `cd backend` before any npm command.** There is no root `package.json`. Nothing runs from the repo root.
- **No new dependencies.** Not on either side. TanStack Query is the server-state answer, `frontend/lib/api/*` is the client layer, Drizzle is the ORM. The recurrence work is designed specifically to avoid a date library.
- **`backend/` conventions:** single quotes, absolute `src/...` imports (no path alias), TS `strict` **off** (`noImplicitAny: false`), Prettier enforced as an ESLint **error**.
- **`frontend/` conventions:** double quotes, `@/...` alias imports **exclusively**, TS `strict` **on**, no Prettier installed.
- **⚠️ There is no RLS in RDS. The API is the entire trust boundary.** Every query must scope itself. A missed scope is a data breach, not a bug.
- **Never take an actor id from the request body.** The caller always comes from the verified token (`req.user.id`).
- **Prefer 404 over 403** when a caller has no claim on a resource. 403 only where the caller already provably has a claim.
- **One error envelope:** `{ statusCode, message, timestamp, path, method }`. `message` is an array for validation failures, a string otherwise. Produced by `GlobalExceptionFilter`; do not hand-roll error bodies.
- **CI gates** (Node 20) — backend: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`. Frontend: `npm run lint`, `npm run type-check`. `/ci-check` reproduces them locally.
- **⚠️ Nothing in CI catches a dead Tailwind class.** Every new screen needs its light *and* dark classes verified by eye. See the verification section at `frontend/CLAUDE.md:86`.
- Do not edit `backend/src/programming/service/programming-access.ts`. This feature is additive; the #35 co-coach rules keep their current behavior.
- Do not use em dashes in AWS resource names or descriptions (no AWS work in this plan, but the rule stands).

---

## File Structure

**Backend — created:**

| File | Responsibility |
|---|---|
| `backend/src/teams/teams.module.ts` | Wires two controllers and two services |
| `backend/src/teams/service/team-access.ts` | **The entire authorization for this feature.** Membership lookup, team and event assertions |
| `backend/src/teams/service/team-access.spec.ts` | Pins every rule in the file above |
| `backend/src/teams/service/recurrence.ts` | Pure expansion of a recurrence rule to occurrences. No DB, no Nest |
| `backend/src/teams/service/recurrence.spec.ts` | DST correctness and the 52-week span bound |
| `backend/src/teams/service/teams.service.ts` | Team CRUD and membership |
| `backend/src/teams/service/teams.service.spec.ts` | Team service rules against the mocked client |
| `backend/src/teams/service/events.service.ts` | Event CRUD, series expansion, participants |
| `backend/src/teams/service/events.service.spec.ts` | Event service rules against the mocked client |
| `backend/src/teams/controller/teams.controller.ts` | Routes under `/teams` |
| `backend/src/teams/controller/events.controller.ts` | Routes under `/events` |
| `backend/src/teams/dto/team.dto.ts` | `CreateTeamDto`, `UpdateTeamDto`, `AddTeamMemberDto` |
| `backend/src/teams/dto/event.dto.ts` | `CreateEventDto`, `RecurrenceDto`, `UpdateEventDto`, `EventQueryDto`, `UpdateScopeQueryDto`, `AddParticipantDto` |
| `backend/src/teams/dto/event.dto.spec.ts` | Time ordering, required end date, weekday bounds |
| `backend/src/teams/dto/validators.ts` | `@IsIanaTimeZone()` and `@IsAfter()`. No DB, so no `ValidatorsModule` registration |
| `backend/src/teams/dto/validators.spec.ts` | Pins that fixed-offset aliases like `EST` are rejected |
| `backend/test/teams/teams.e2e-spec.ts` | Both controllers against real Postgres |

**Backend — modified:**

| File | Change |
|---|---|
| `backend/src/db/schema.ts` | Two enums; `teams` gains three columns; three new tables |
| `backend/src/db/migrations/0004_*.sql` + `meta/` | Generated by `npm run db:generate`. Do not hand-write |
| `backend/src/app.module.ts` | Import `TeamsModule` |
| `backend/test/helpers/sweep.ts` | Sweep the three new tables |

**Frontend — created:**

| File | Responsibility |
|---|---|
| `frontend/types/team.ts` | `Team`, `TeamMember`, `TeamDetail`, `TeamRole` |
| `frontend/types/event.ts` | `PracticeEvent`, `EventParticipant`, `EventDetail`, `EventStatus` |
| `frontend/lib/api/teams.ts` | Team reads and writes |
| `frontend/lib/api/events.ts` | Event reads and writes |
| `frontend/app/(app)/(tabs)/calendar.tsx` | The calendar. Both roles |
| `frontend/app/(app)/teams/[teamId].tsx` | Team roster management |
| `frontend/app/(app)/events/[eventId].tsx` | Event detail and participants |
| `frontend/app/(app)/events/new.tsx` | Create a one-off or a series. Coach only |

**Frontend — modified:**

| File | Change |
|---|---|
| `frontend/types/index.ts` | Re-export the two new type modules |
| `frontend/app/(app)/(tabs)/_layout.tsx` | Add the ungated Calendar tab |

**Docs — modified:**

| File | Change |
|---|---|
| `docs/AUTHORIZATION.md` | New `### teams / events` section under "The matrix" |
| `docs/ROADMAP.md` | Update open question 3 |
| `CLAUDE.md` | `lib/api/*` module count nine → eleven |

---

### Task 1: Schema and migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create (generated): `backend/src/db/migrations/0004_*.sql` and `backend/src/db/migrations/meta/0004_snapshot.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `teamMemberRoleEnum`, `eventStatusEnum`, `teams` (with `name`, `timezone`, `createdBy`), `teamMembers`, `events`, `eventParticipants` — all exported from `src/db/schema`. Every later backend task imports from here.

- [ ] **Step 1: Start a clean local database**

```bash
cd backend && npm run db:up && npm run db:migrate && npm run db:seed && npm run db:verify
```

Expected: migrations `0000`–`0003` apply, reference data seeds, verify passes. This confirms your starting point is clean before you change anything. Postgres listens on port **55440**.

- [ ] **Step 2: Add the two enums**

In `backend/src/db/schema.ts`, in the `Enums` section, after `messageTypeEnum` (around line 63):

```ts
export const teamMemberRoleEnum = pgEnum('team_member_role', ['coach', 'athlete']);

export const eventStatusEnum = pgEnum('event_status', ['scheduled', 'canceled']);
```

- [ ] **Step 3: Give `teams` its columns**

Replace the whole `teams` declaration (currently `schema.ts:92`, comment included):

```ts
/** A named group of athletes and coaches. Was a two-column placeholder with no
 * rows until 2026-09-22; see docs/superpowers/specs/2026-09-22-teams-and-practice-events-design.md.
 *
 * A team grants **nothing** except calendar scope and roster visibility.
 * Programming, messaging and roster authorization stay entirely on
 * `coach_athlete_relationships` — that is what keeps the new trust boundary
 * inside the new tables.
 *
 * `timezone` has no default on purpose. An implicit zone is how a 17:00 practice
 * silently becomes 16:00 on the first Sunday of November.
 *
 * ⚠️ `created_by` forward-references `coaches`, which is declared further down
 * this file. Drizzle evaluates the `() =>` lazily so this is fine, but do not
 * "tidy" it into a direct reference.
 */
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => coaches.id),
});
```

Note `.defaultRandom()` is new on `id`. The table has zero rows, so all of this applies without a backfill.

- [ ] **Step 4: Add the three new tables**

Append to the **end** of `backend/src/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Teams and practice events
//
// `team_members` is the only membership record. `athletes.team_id` predates this
// and stays dead — dropping it is a separate migration, deliberately, so the
// revert of this feature does not also revert a schema cleanup.
// ---------------------------------------------------------------------------

/** One row per person per team. `user_id` references `users`, not
 * `athletes`/`coaches`, because `role` is what carries which of the two they are
 * here — and a user may be a coach on one team and nothing on another.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: teamMemberRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** On the PAIR. One row per person per team, which also forbids being both
     * coach and athlete of the same team — see open question 1 in the spec. That
     * restriction is a side effect of this index, so if a player-coach ever needs
     * supporting, change `role` rather than relaxing this. */
    uniqueIndex('team_members_team_id_user_id_uniq').on(table.teamId, table.userId),
    // "my teams" runs on every calendar load.
    index('team_members_user_id_idx').on(table.userId),
    // "the team's athletes" and "the team's coaches" are both hot, and role is
    // the filter, so one composite serves both.
    index('team_members_team_id_role_idx').on(table.teamId, table.role),
  ],
);

/** One practice. A recurring series is N of these rows sharing a `series_id`.
 *
 * Occurrences are materialized rather than computed from a rule because a video
 * submission (the next spec) needs a real `events.id` to foreign-key against. A
 * computed occurrence has no primary key. At three practices a week for a
 * sixteen-week semester this is ~48 rows per team, so the duplication is free.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    /** Null for a one-off. Deliberately **not** a foreign key: there is no
     * `event_series` table, and inventing one to hold a single id would add a
     * join to every calendar read for nothing. */
    seriesId: uuid('series_id'),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** An absolute end rather than a duration. A duration would need the same
     * timezone resolution applied a second time at every read. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    notes: text('notes'),
    status: eventStatusEnum('status').notNull().default('scheduled'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => coaches.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The calendar filters by team and sorts by time, so one index serves both
    // and Postgres skips the sort — same shape as workouts_athlete_id_date_idx.
    index('events_team_id_starts_at_idx').on(table.teamId, table.startsAt),
    // "edit all future events in this series" filters on it.
    index('events_series_id_idx').on(table.seriesId),
  ],
);

/** Who is at a practice.
 *
 * ⚠️ **These rows outlive team membership on purpose.** Removing someone from a
 * team deletes their `team_members` row and leaves these alone: they are a record
 * that a person was at a practice, which is training history rather than
 * membership. The video spec will hang submissions off them.
 *
 * No `status` column yet. Attendance and RSVP are out of scope, and a column
 * nothing writes is worse than a migration later.
 */
export const eventParticipants = pgTable(
  'event_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_participants_event_id_user_id_uniq').on(table.eventId, table.userId),
    // "my upcoming practices" starts from the user, not the event.
    index('event_participants_user_id_event_id_idx').on(table.userId, table.eventId),
  ],
);
```

- [ ] **Step 5: Generate the migration**

```bash
cd backend && npm run db:generate
```

Expected: a new `src/db/migrations/0004_<random-name>.sql` plus `meta/0004_snapshot.json` and an updated `meta/_journal.json`.

- [ ] **Step 6: Read the generated SQL before applying it**

```bash
cd backend && cat src/db/migrations/0004_*.sql
```

Confirm it contains: `CREATE TYPE ... team_member_role`, `CREATE TYPE ... event_status`, three `CREATE TABLE` statements, `ALTER TABLE "teams" ADD COLUMN` for `name` / `timezone` / `created_by`, and six `CREATE INDEX`/`CREATE UNIQUE INDEX` statements. If it contains a `DROP TABLE` or touches any table other than `teams`, stop — something in Step 3 or 4 is wrong.

- [ ] **Step 7: Apply and verify against real Postgres**

```bash
cd backend && npm run db:migrate
docker compose exec -T db psql -U postgres -d liftoff -c '\d team_members' -c '\d events' -c '\d event_participants' -c '\d teams'
```

Expected: all four tables present; `teams` shows `name`, `timezone`, `created_by` as `not null`; the indexes listed in Step 4 appear under each table.

- [ ] **Step 8: Confirm the type-check and build still pass**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all three clean.

- [ ] **Step 9: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrations
git commit -m "Give teams meaning, and add practice events tables"
```

---

### Task 2: Recurrence expansion (pure module)

**Files:**
- Create: `backend/src/teams/service/recurrence.ts`
- Test: `backend/src/teams/service/recurrence.spec.ts`

**Interfaces:**
- Consumes: nothing. No DB, no Nest, no imports outside the standard library.
- Produces:
  - `MAX_SERIES_WEEKS = 52`
  - `interface RecurrenceRule { weekdays: number[]; startTime: string; durationMinutes: number; startDate: string; endDate: string }`
  - `interface Occurrence { startsAt: Date; endsAt: Date }`
  - `function expandSeries(rule: RecurrenceRule, timeZone: string): Occurrence[]`
  - `function zonedWallTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date` — month is 1-based

This is written test-first because it is the only place in the feature where a wrong answer is silent. Everything else fails loudly.

- [ ] **Step 1: Confirm the calendar facts the tests depend on**

The DST test below hard-codes dates. Verify them rather than trusting the plan:

```bash
cd backend && node -e "
for (const d of ['2026-10-28','2026-11-01','2026-11-04']) {
  console.log(d, new Date(d + 'T12:00:00Z').toUTCString().slice(0,3));
}
console.log('offset Oct 28:', new Date('2026-10-28T12:00:00Z').toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}));
console.log('offset Nov 04:', new Date('2026-11-04T12:00:00Z').toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}));
"
```

Expected: `2026-10-28 Wed`, `2026-11-01 Sun`, `2026-11-04 Wed`, and the offsets read `EDT` then `EST`. US DST ends on the first Sunday of November, which in 2026 is the 1st — so the two Wednesdays sit either side of the transition. If any of this disagrees, fix the dates in the tests before writing them.

- [ ] **Step 2: Write the failing tests**

Create `backend/src/teams/service/recurrence.spec.ts`:

```ts
import { expandSeries, zonedWallTimeToInstant } from './recurrence';

const NY = 'America/New_York';

/** Reads an instant back as wall-clock time in a zone, which is what an athlete
 * actually sees on their phone. Asserting on this rather than only on the ISO
 * string is the difference between "the number changed" and "the practice moved". */
const wallTime = (instant: Date, timeZone = NY): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);

describe('zonedWallTimeToInstant', () => {
  it('resolves a wall time during daylight saving time', () => {
    // 2026-10-28 is EDT, UTC-4.
    expect(zonedWallTimeToInstant(2026, 10, 28, 17, 0, NY).toISOString()).toBe(
      '2026-10-28T21:00:00.000Z',
    );
  });

  it('resolves the same wall time after the zone falls back', () => {
    // 2026-11-04 is EST, UTC-5. Same 17:00, one hour later in UTC.
    expect(zonedWallTimeToInstant(2026, 11, 4, 17, 0, NY).toISOString()).toBe(
      '2026-11-04T22:00:00.000Z',
    );
  });

  it('treats UTC as its own zone', () => {
    expect(zonedWallTimeToInstant(2026, 11, 4, 17, 0, 'UTC').toISOString()).toBe(
      '2026-11-04T17:00:00.000Z',
    );
  });
});

describe('expandSeries', () => {
  /** ⚠️ **The most important test in this feature.**
   *
   * A weekly practice must keep its *local* time across a DST transition. Get this
   * wrong and a 5pm practice silently becomes 4pm halfway through the semester —
   * which looks like athletes showing up an hour late, not like a bug. Nothing
   * else in the codebase would catch it: the e2e suite skips on feature-branch
   * pushes and skips itself when the Supabase secrets are absent.
   */
  it('keeps a weekly practice at the same local time across a DST transition', () => {
    const occurrences = expandSeries(
      {
        weekdays: [3], // Wednesday
        startTime: '17:00',
        durationMinutes: 90,
        startDate: '2026-10-28',
        endDate: '2026-11-04',
      },
      NY,
    );

    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual(['17:00', '17:00']);
    // The instants differ by 8 days, not 7, because the zone lost an hour.
    expect(occurrences[0].startsAt.toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(occurrences[1].startsAt.toISOString()).toBe('2026-11-04T22:00:00.000Z');
  });

  it('spaces occurrences exactly a week apart when no transition intervenes', () => {
    const occurrences = expandSeries(
      {
        weekdays: [3],
        startTime: '17:00',
        durationMinutes: 90,
        startDate: '2026-09-23',
        endDate: '2026-10-07',
      },
      NY,
    );

    expect(occurrences).toHaveLength(3);
    const gaps = occurrences
      .slice(1)
      .map((o, i) => o.startsAt.getTime() - occurrences[i].startsAt.getTime());
    expect(gaps).toEqual([7 * 86_400_000, 7 * 86_400_000]);
  });

  it('applies the duration to produce ends_at', () => {
    const [first] = expandSeries(
      {
        weekdays: [3],
        startTime: '17:00',
        durationMinutes: 90,
        startDate: '2026-09-23',
        endDate: '2026-09-23',
      },
      NY,
    );

    expect(wallTime(first.endsAt)).toBe('18:30');
  });

  it('returns multiple weekdays in chronological order', () => {
    const occurrences = expandSeries(
      {
        weekdays: [3, 5, 0], // Wednesday, Friday, Sunday — deliberately unsorted
        startTime: '17:00',
        durationMinutes: 60,
        startDate: '2026-09-23', // a Wednesday
        endDate: '2026-09-27', // the Sunday after
      },
      NY,
    );

    expect(occurrences).toHaveLength(3);
    const times = occurrences.map((o) => o.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('includes both the start and end date when they match a weekday', () => {
    const occurrences = expandSeries(
      {
        weekdays: [3],
        startTime: '17:00',
        durationMinutes: 60,
        startDate: '2026-09-23',
        endDate: '2026-09-30',
      },
      NY,
    );

    expect(occurrences).toHaveLength(2);
  });

  it('rejects a span longer than 52 weeks', () => {
    expect(() =>
      expandSeries(
        {
          weekdays: [3],
          startTime: '17:00',
          durationMinutes: 60,
          startDate: '2026-01-01',
          endDate: '2027-06-01',
        },
        NY,
      ),
    ).toThrow(/52 weeks/);
  });

  /** The span bound is the only bound needed, and this pins why: seven weekdays
   * across the full 52 weeks is 365 occurrences, which is a fine single insert.
   * An explicit occurrence cap was considered and dropped as unreachable. */
  it('caps a maximal daily series at one row per day', () => {
    const occurrences = expandSeries(
      {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: '17:00',
        durationMinutes: 60,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      NY,
    );

    expect(occurrences).toHaveLength(365);
  });

  it('rejects an empty weekday list', () => {
    expect(() =>
      expandSeries(
        {
          weekdays: [],
          startTime: '17:00',
          durationMinutes: 60,
          startDate: '2026-09-23',
          endDate: '2026-09-30',
        },
        NY,
      ),
    ).toThrow(/at least one weekday/);
  });

  it('rejects an end date before the start date', () => {
    expect(() =>
      expandSeries(
        {
          weekdays: [3],
          startTime: '17:00',
          durationMinutes: 60,
          startDate: '2026-09-30',
          endDate: '2026-09-23',
        },
        NY,
      ),
    ).toThrow(/before/);
  });

  it('rejects a malformed date', () => {
    expect(() =>
      expandSeries(
        {
          weekdays: [3],
          startTime: '17:00',
          durationMinutes: 60,
          startDate: '23-09-2026',
          endDate: '2026-09-30',
        },
        NY,
      ),
    ).toThrow(/YYYY-MM-DD/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && npx jest src/teams/service/recurrence.spec.ts
```

Expected: FAIL — `Cannot find module './recurrence'`.

- [ ] **Step 4: Write the implementation**

Create `backend/src/teams/service/recurrence.ts`:

```ts
/** Expansion of a recurring practice series into concrete occurrences.
 *
 * Pure: no database, no Nest, no dependencies. That is the point — this is the
 * one place in the feature where a wrong answer is *silent*, so it has to be
 * cheaply unit-testable.
 *
 * ⚠️ **Why this is not SQL.** The obvious implementation is
 * `generate_series(...) AT TIME ZONE ...` in Postgres, which would also be
 * correct. But `src/db/testing/db-mock.ts` ignores `where` and every other clause
 * by design, so no unit test can observe generated SQL — the DST behaviour would
 * only be covered by e2e, which feature-branch pushes skip and which skips itself
 * when the Supabase secrets or the auth health probe are unavailable. A silent
 * one-hour shift halfway through a semester needs a gate that always runs.
 *
 * ⚠️ **Why there is no date library.** Node 20 ships full ICU, so
 * `Intl.DateTimeFormat` with a `timeZone` gives correct offsets including across
 * transitions. Adding `date-fns` to the backend for this would be a dependency
 * the project has not agreed to. Precedent: `programming/service/e1rm.ts` is a
 * pure domain module with its spec beside it.
 */

/** The only bound on how large a series may be.
 *
 * An explicit occurrence cap was considered and **dropped as unreachable**: seven
 * weekdays across 52 weeks is 365 occurrences, and 365 rows in one transaction is
 * not a problem worth a second check nobody can trigger. If daily recurrence over
 * multiple years is ever wanted, add the cap back *and* a test that reaches it.
 */
export const MAX_SERIES_WEEKS = 52;

const DAY_MS = 86_400_000;

export interface RecurrenceRule {
  /** 0 = Sunday .. 6 = Saturday. Order does not matter; output is chronological. */
  weekdays: number[];
  /** Local wall-clock start in the team's zone, "HH:MM". */
  startTime: string;
  durationMinutes: number;
  /** Inclusive local dates, "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

/** Offset in ms between UTC and `timeZone` at a given instant. Positive east. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl did not report "${type}" for zone "${timeZone}"`);
    return Number(part.value);
  };

  // `% 24` because some ICU builds report midnight as hour 24 under hour12: false.
  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );

  return asIfUtc - instant.getTime();
}

/** Resolves a local wall-clock time in `timeZone` to an absolute instant.
 *
 * `month` is 1-based, matching how humans and "YYYY-MM-DD" write it, rather than
 * the 0-based month the Date constructor takes.
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  // First guess: read the offset at the instant the wall time *would* be if the
  // zone were UTC, then shift by it.
  const firstOffset = zoneOffsetMs(new Date(asIfUtc), timeZone);
  let instant = new Date(asIfUtc - firstOffset);

  // On the two days a year the zone changes, the offset at the corrected instant
  // can differ from the first guess. One correction pass settles every real zone.
  const secondOffset = zoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) {
    instant = new Date(asIfUtc - secondOffset);
  }

  return instant;
}

/** Parses "YYYY-MM-DD" to a UTC-midnight timestamp used purely as a calendar
 * carrier. UTC has no DST, so adding whole days to it can never drift. */
function parseLocalDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${value}"`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseWallTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Expected an HH:MM time, got "${value}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`"${value}" is not a valid time of day`);
  }
  return { hour, minute };
}

/** Expands a rule into one occurrence per matching local date.
 *
 * Dates are walked by whole days over a UTC-midnight cursor and each wall time is
 * resolved to an instant **independently**. That is what keeps a 17:00 practice at
 * 17:00 across a transition — adding 7 × 86,400,000 ms to the previous *instant*
 * is the bug this avoids.
 */
export function expandSeries(rule: RecurrenceRule, timeZone: string): Occurrence[] {
  if (rule.weekdays.length === 0) {
    throw new Error('A recurring series needs at least one weekday');
  }

  const { hour, minute } = parseWallTime(rule.startTime);
  const start = parseLocalDate(rule.startDate);
  const end = parseLocalDate(rule.endDate);

  if (end < start) {
    throw new Error('endDate is before startDate');
  }

  const spanDays = Math.round((end - start) / DAY_MS);
  if (spanDays > MAX_SERIES_WEEKS * 7) {
    throw new Error(`A series may not span more than ${MAX_SERIES_WEEKS} weeks`);
  }

  const weekdays = new Set(rule.weekdays);
  const occurrences: Occurrence[] = [];

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const cursor = new Date(start + offset * DAY_MS);
    if (!weekdays.has(cursor.getUTCDay())) continue;

    const startsAt = zonedWallTimeToInstant(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate(),
      hour,
      minute,
      timeZone,
    );

    occurrences.push({
      startsAt,
      endsAt: new Date(startsAt.getTime() + rule.durationMinutes * 60_000),
    });
  }

  return occurrences;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/recurrence.spec.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Lint and type-check**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

Expected: clean. `npm run lint` runs with `--fix`, so re-read the file if it reformats anything.

- [ ] **Step 7: Commit**

```bash
git add backend/src/teams/service/recurrence.ts backend/src/teams/service/recurrence.spec.ts
git commit -m "Expand recurring practice series without drifting across DST"
```

---

### Task 3: The authorization file

**Files:**
- Create: `backend/src/teams/service/team-access.ts`
- Test: `backend/src/teams/service/team-access.spec.ts`

**Interfaces:**
- Consumes: `teamMembers`, `events` from `src/db/schema` (Task 1); `Database` from `src/db/db.module`.
- Produces:
  - `type TeamRole = 'coach' | 'athlete'`
  - `interface EventOwners { id: string; teamId: string; seriesId: string | null; startsAt: Date; status: 'scheduled' | 'canceled'; createdBy: string }`
  - `loadMembership(db: Database, teamId: string, userId: string): Promise<TeamRole | null>`
  - `assertReadableTeam(db: Database, teamId: string, callerId: string): Promise<TeamRole>`
  - `assertManageableTeam(db: Database, teamId: string, callerId: string): Promise<void>`
  - `loadReadableEvent(db: Database, eventId: string, callerId: string): Promise<EventOwners>`
  - `loadManageableEvent(db: Database, eventId: string, callerId: string): Promise<EventOwners>`

⚠️ **This file is the entire authorization for the feature.** There is no RLS. Every rule below is the only thing standing between a caller and another team's calendar.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/teams/service/team-access.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from 'src/db/db.module';
import { makeTestDb } from 'src/db/testing/db-mock';
import {
  assertManageableTeam,
  assertReadableTeam,
  loadManageableEvent,
  loadMembership,
  loadReadableEvent,
} from './team-access';

const TEAM = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const COACH_A = '33333333-3333-4333-8333-333333333333';
const COACH_B = '44444444-4444-4444-8444-444444444444';
const ATHLETE = '55555555-5555-4555-8555-555555555555';
const STRANGER = '66666666-6666-4666-8666-666666666666';

/** The mocked client ignores `where` entirely — by design, so specs survive query
 * reordering. So scripting one row is what "a membership exists" means here, and
 * scripting none is what "it does not" means. The *shape* of the filter is not
 * observable in this file; that is what the e2e suite is for. */
const membership = (role: 'coach' | 'athlete') => [{ role }];

const eventRow = {
  id: EVENT,
  teamId: TEAM,
  seriesId: null,
  startsAt: new Date('2026-09-23T21:00:00.000Z'),
  status: 'scheduled' as const,
  createdBy: COACH_A,
};

const db = (script: Parameters<typeof makeTestDb>[0]) =>
  makeTestDb(script).db as unknown as Database;

describe('loadMembership', () => {
  it('returns the role when the user is on the team', async () => {
    await expect(
      loadMembership(db({ team_members: [membership('coach')] }), TEAM, COACH_A),
    ).resolves.toBe('coach');
  });

  it('returns null when the user is not on the team', async () => {
    await expect(loadMembership(db({}), TEAM, STRANGER)).resolves.toBeNull();
  });

  /** Two coaches on one team each pass independently. This is a PAIR lookup,
   * exactly like isActiveCoachOf — there is no head-coach concept and adding one
   * would be a decision, not a refactor. */
  it('resolves each coach of a shared team independently', async () => {
    const script = { team_members: [membership('coach'), membership('coach')] };
    const handle = db(script);

    await expect(loadMembership(handle, TEAM, COACH_A)).resolves.toBe('coach');
    await expect(loadMembership(handle, TEAM, COACH_B)).resolves.toBe('coach');
  });
});

describe('assertReadableTeam', () => {
  it('returns the role for an athlete member', async () => {
    await expect(
      assertReadableTeam(db({ team_members: [membership('athlete')] }), TEAM, ATHLETE),
    ).resolves.toBe('athlete');
  });

  /** ⚠️ 404, never 403. A 403 would confirm the id names a real team, which for a
   * caller trying ids in sequence answers "who trains together" — the same
   * reasoning recorded for coach requests, conversations and workouts. */
  it('throws 404 rather than 403 for a non-member', async () => {
    await expect(assertReadableTeam(db({}), TEAM, STRANGER)).rejects.toThrow(NotFoundException);
  });

  it('names the team id in the 404, so a real miss is debuggable', async () => {
    await expect(assertReadableTeam(db({}), TEAM, STRANGER)).rejects.toThrow(TEAM);
  });
});

describe('assertManageableTeam', () => {
  it('allows a coach of the team', async () => {
    await expect(
      assertManageableTeam(db({ team_members: [membership('coach')] }), TEAM, COACH_A),
    ).resolves.toBeUndefined();
  });

  /** ⚠️ 403 here is correct rather than a leak. The 404-over-403 rule exists so a
   * caller with *no* claim cannot confirm the id is real; an athlete member
   * already reads this team, so the 403 discloses nothing and is the more useful
   * answer. Same reasoning as loadProgrammableWorkout. */
  it('throws 403 for an athlete member, who can already see the team', async () => {
    await expect(
      assertManageableTeam(db({ team_members: [membership('athlete')] }), TEAM, ATHLETE),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws 404 for a non-member, who cannot learn the team exists', async () => {
    await expect(assertManageableTeam(db({}), TEAM, STRANGER)).rejects.toThrow(NotFoundException);
  });
});

describe('loadReadableEvent', () => {
  it('returns the event for any member of its team, athlete included', async () => {
    const handle = db({ events: [[eventRow]], team_members: [membership('athlete')] });

    await expect(loadReadableEvent(handle, EVENT, ATHLETE)).resolves.toEqual(eventRow);
  });

  /** An athlete who is on the team but NOT a participant of this practice still
   * reads it. Decided deliberately: the calendar is a team artifact, and a
   * practice that is invisible unless you are in it cannot be asked to join. */
  it('does not require the caller to be a participant', async () => {
    const handle = db({ events: [[eventRow]], team_members: [membership('athlete')] });

    await expect(loadReadableEvent(handle, EVENT, ATHLETE)).resolves.toEqual(eventRow);
  });

  it('throws 404 when the event does not exist', async () => {
    await expect(loadReadableEvent(db({}), EVENT, COACH_A)).rejects.toThrow(NotFoundException);
  });

  /** The event exists, the caller is a stranger to its team. Both cases must be
   * indistinguishable from outside, so this is the same 404 with the same message
   * as the case above. */
  it('throws the same 404 for a stranger as for a missing event', async () => {
    const present = db({ events: [[eventRow]] });
    const absent = db({});

    const strangerError = await loadReadableEvent(present, EVENT, STRANGER).catch((e: Error) => e);
    const missingError = await loadReadableEvent(absent, EVENT, STRANGER).catch((e: Error) => e);

    expect(strangerError).toBeInstanceOf(NotFoundException);
    expect(strangerError.message).toBe(missingError.message);
  });
});

describe('loadManageableEvent', () => {
  it('allows any coach of the team, not only the one who created the event', async () => {
    const handle = db({ events: [[eventRow]], team_members: [membership('coach')] });

    // eventRow.createdBy is COACH_A; COACH_B is a different coach of the team.
    await expect(loadManageableEvent(handle, EVENT, COACH_B)).resolves.toEqual(eventRow);
  });

  it('throws 403 for an athlete member', async () => {
    const handle = db({ events: [[eventRow]], team_members: [membership('athlete')] });

    await expect(loadManageableEvent(handle, EVENT, ATHLETE)).rejects.toThrow(ForbiddenException);
  });

  it('throws 404 for a stranger', async () => {
    const handle = db({ events: [[eventRow]] });

    await expect(loadManageableEvent(handle, EVENT, STRANGER)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx jest src/teams/service/team-access.spec.ts
```

Expected: FAIL — `Cannot find module './team-access'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/teams/service/team-access.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from 'src/db/db.module';
import { events, teamMembers } from 'src/db/schema';

/** The ownership walk for teams and practice events.
 *
 * ⚠️ **There is no RLS behind any of this.** Every rule in this file is the entire
 * authorization for a team or event operation.
 *
 * A team grants **nothing** beyond calendar scope and roster visibility.
 * Programming, messaging and roster access stay on
 * `coach_athlete_relationships` and are untouched by this module — which is what
 * confines the new trust boundary to the new tables. Do not add a rule here that
 * reaches into `workouts`, `sets` or `messages`.
 *
 * The rules, and the two places they differ from `programming-access.ts`:
 *
 *  - **Read** a team, its roster, its events — any member, coach or athlete.
 *  - **Change** anything — any **coach** of the team, *including one who did not
 *    create the thing being changed*. This is the opposite of the workout rule,
 *    on purpose: a shared practice calendar only its author can fix is worse than
 *    the Google Calendar it replaces, and the blast radius of moving a practice is
 *    a confused athlete rather than a destroyed training record. `created_by` is
 *    kept for attribution, not for authorization.
 *  - **Reading an event does not require being its participant.** The calendar is
 *    a team artifact; a practice invisible unless you are already in it cannot be
 *    asked to join.
 */

export type TeamRole = 'coach' | 'athlete';

/** Who an event belongs to, plus the fields every caller needs before deciding
 * what to do with it. `seriesId` and `startsAt` are here because `?scope=future`
 * needs both to pick the rest of the series. */
export interface EventOwners {
  id: string;
  teamId: string;
  seriesId: string | null;
  startsAt: Date;
  status: 'scheduled' | 'canceled';
  createdBy: string;
}

/** The caller's role on a team, or null when they are not on it.
 *
 * One query returning the role, rather than separate `isTeamMember` and
 * `isTeamCoach` predicates. Two predicates would mean two round trips on every
 * write and — the reason that matters — two chances to check the wrong one. Same
 * discipline as `loadSetOwners` joining instead of walking three lookups: one
 * query cannot be half-authorized.
 */
export async function loadMembership(
  db: Database,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const [row] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  return row?.role ?? null;
}

/** Asserts the caller may read a team, and hands back their role so the caller
 * does not query for it again.
 *
 * A non-member gets a 404 naming the team, not a 403. Team ids appear in every
 * event payload, so a 403 here would answer "is this a real team and am I outside
 * it" for any id a caller cares to try.
 */
export async function assertReadableTeam(
  db: Database,
  teamId: string,
  callerId: string,
): Promise<TeamRole> {
  const role = await loadMembership(db, teamId, callerId);

  if (!role) {
    throw new NotFoundException(`Team with ID ${teamId} could not be found`);
  }

  return role;
}

/** Asserts the caller may change a team or its membership: a coach of it.
 *
 * Read access is checked first, so a stranger still gets a 404 rather than a 403
 * revealing the team exists. An athlete member gets the 403, which is correct
 * rather than a leak — they can already read this team, so it tells them nothing
 * new and is the more useful answer.
 */
export async function assertManageableTeam(
  db: Database,
  teamId: string,
  callerId: string,
): Promise<void> {
  const role = await assertReadableTeam(db, teamId, callerId);

  if (role !== 'coach') {
    throw new ForbiddenException('Only a coach of this team can change it');
  }
}

/** Loads an event plus the caller's role on its team, in two queries.
 *
 * Private because every caller wants one of the two wrappers below. Returning the
 * role alongside the event is what stops `loadManageableEvent` re-querying
 * membership after `loadReadableEvent` already did.
 */
async function loadEventForMember(
  db: Database,
  eventId: string,
  callerId: string,
): Promise<{ event: EventOwners; role: TeamRole }> {
  const notFound = new NotFoundException(`Event with ID ${eventId} could not be found`);

  const [event] = await db
    .select({
      id: events.id,
      teamId: events.teamId,
      seriesId: events.seriesId,
      startsAt: events.startsAt,
      status: events.status,
      createdBy: events.createdBy,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) throw notFound;

  const role = await loadMembership(db, event.teamId, callerId);

  // Deliberately the *same* exception as a missing event. A distinct message
  // would let a stranger tell "this event exists but not for you" from "no such
  // event", which is the disclosure the 404 exists to prevent.
  if (!role) throw notFound;

  return { event, role };
}

/** Loads an event the caller may read: any event of any team they belong to. */
export async function loadReadableEvent(
  db: Database,
  eventId: string,
  callerId: string,
): Promise<EventOwners> {
  const { event } = await loadEventForMember(db, eventId, callerId);
  return event;
}

/** Loads an event the caller may change: any event of a team they coach.
 *
 * Note what is **not** checked: `createdBy`. Any coach of the team may edit any
 * of its events. See the file comment.
 */
export async function loadManageableEvent(
  db: Database,
  eventId: string,
  callerId: string,
): Promise<EventOwners> {
  const { event, role } = await loadEventForMember(db, eventId, callerId);

  if (role !== 'coach') {
    throw new ForbiddenException('Only a coach of this team can change its events');
  }

  return event;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/team-access.spec.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Lint and type-check**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/teams/service/team-access.ts backend/src/teams/service/team-access.spec.ts
git commit -m "Add the authorization walk for teams and practice events"
```

---

### Task 4: DTOs and validators

**Files:**
- Create: `backend/src/teams/dto/validators.ts`
- Create: `backend/src/teams/dto/team.dto.ts`
- Create: `backend/src/teams/dto/event.dto.ts`
- Test: `backend/src/teams/dto/validators.spec.ts`
- Test: `backend/src/teams/dto/event.dto.spec.ts`

**Interfaces:**
- Consumes: `MAX_SERIES_WEEKS` from `../service/recurrence` (Task 2).
- Produces:
  - `validators.ts`: `isIanaTimeZone(value: unknown): boolean`, `IsIanaTimeZone(options?)`, `IsAfter(property: string, options?)`
  - `team.dto.ts`: `CreateTeamDto { name, timezone }`, `UpdateTeamDto { name?, timezone? }`, `AddTeamMemberDto { user_id, role }`
  - `event.dto.ts`: `RecurrenceDto { weekdays, start_time, duration_minutes, start_date, end_date }`, `CreateEventDto { team_id, title, location?, notes?, starts_at?, ends_at?, recurrence? }`, `UpdateEventDto { title?, location?, notes?, starts_at?, ends_at? }`, `EventQueryDto { team_id, from, to }`, `UpdateScopeQueryDto { scope? }`, `AddParticipantDto { user_id }`

Note the request/response casing split this codebase already uses: **DTO and JSON fields are `snake_case`** (`athlete_id`, `override_value`), while TypeScript internals are `camelCase`. Follow it.

The global `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true, transform: true` (`src/main.ts:13`), so an unexpected body field is a 400 rather than silently ignored. You do not need to guard for that.

- [ ] **Step 1: Write the failing validator tests**

Create `backend/src/teams/dto/validators.spec.ts`:

```ts
import { isIanaTimeZone } from './validators';

describe('isIanaTimeZone', () => {
  it('accepts a real region/city zone', () => {
    expect(isIanaTimeZone('America/New_York')).toBe(true);
  });

  it('accepts UTC', () => {
    expect(isIanaTimeZone('UTC')).toBe(true);
  });

  it('rejects a zone Node does not know', () => {
    expect(isIanaTimeZone('Nonsense/Zone')).toBe(false);
  });

  /** ⚠️ **The reason this validator is not just a try/catch around Intl.**
   *
   * ICU accepts "EST" as a legacy fixed-offset alias — it is a real zone as far as
   * Intl is concerned, and it has **no DST**. A team stored as EST would sit at
   * UTC-5 all year, so every practice after the first Sunday in November would
   * silently be an hour off from what the coach meant. That is precisely the bug
   * the whole timezone design exists to prevent, so the fixed-offset aliases are
   * rejected here rather than allowed to look correct.
   */
  it('rejects fixed-offset aliases that have no DST', () => {
    expect(isIanaTimeZone('EST')).toBe(false);
    expect(isIanaTimeZone('MST')).toBe(false);
  });

  it('rejects an empty string and a non-string', () => {
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/dto/validators.spec.ts
```

Expected: FAIL — `Cannot find module './validators'`.

- [ ] **Step 3: Write the validators**

Create `backend/src/teams/dto/validators.ts`:

```ts
import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** Whether a value is a timezone identifier this Node build knows **and** one
 * that actually observes its region's DST rules.
 *
 * Asked of `Intl` rather than checked against a list in this repo, because the tz
 * database changes and a hard-coded list is wrong the first time a zone is added.
 *
 * ⚠️ The `/` requirement is load-bearing, not cosmetic. ICU accepts `EST`, `MST`
 * and friends as legacy **fixed-offset** aliases with no DST at all, so a team
 * stored as `EST` would hold every practice an hour off from the coach's intent
 * for half the year — the exact failure `teams.timezone` exists to prevent. `UTC`
 * is allowed explicitly because it is genuinely offsetless rather than a region
 * pretending not to have seasons.
 */
export function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value !== 'UTC' && !value.includes('/')) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimeZone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isIanaTimeZone(value),
        defaultMessage: () =>
          `${propertyName} must be an IANA time zone such as "America/New_York" ` +
          '(fixed-offset aliases like "EST" are rejected because they do not observe DST)',
      },
    });
  };
}

/** Asserts this property's date is strictly after another property's date.
 *
 * Cross-field, which no built-in class-validator decorator does, and it belongs
 * in the DTO rather than the service: a zero-length or inverted practice is a
 * malformed request, and the 400 should name the field.
 */
export function IsAfter(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate: (value: unknown, args: ValidationArguments): boolean => {
          const other = (args.object as Record<string, unknown>)[args.constraints[0] as string];
          if (typeof value !== 'string' || typeof other !== 'string') return false;

          const end = Date.parse(value);
          const start = Date.parse(other);
          if (Number.isNaN(end) || Number.isNaN(start)) return false;

          return end > start;
        },
        defaultMessage: (args: ValidationArguments) =>
          `${propertyName} must be after ${args.constraints[0] as string}`,
      },
    });
  };
}
```

- [ ] **Step 4: Run the validator tests to verify they pass**

```bash
cd backend && npx jest src/teams/dto/validators.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the team DTOs**

Create `backend/src/teams/dto/team.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsIanaTimeZone } from './validators';

/** Body for `POST /teams`.
 *
 * No `created_by`. The creating coach comes from the verified token — taking an
 * actor id from the body is the bug that once let any user attribute a workout to
 * any coach.
 */
export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIanaTimeZone()
  timezone: string;
}

/** Body for `PATCH /teams/:teamId`. Both fields optional; sending neither is a
 * no-op rather than an error, matching `PATCH /users/profile`. */
export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}

/** Body for `POST /teams/:teamId/members`.
 *
 * `user_id` names *someone else* and the service authorizes the caller's right to
 * add them, so this is not the banned actor-id-from-the-body pattern. Adding an
 * athlete additionally requires an active coach relationship with them.
 */
export class AddTeamMemberDto {
  @IsUUID()
  user_id: string;

  @IsIn(['coach', 'athlete'])
  role: 'coach' | 'athlete';
}
```

- [ ] **Step 6: Write the failing event DTO tests**

Create `backend/src/teams/dto/event.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEventDto, EventQueryDto, UpdateEventDto } from './event.dto';

/** Mirrors what the global ValidationPipe does: plainToInstance, then validate.
 * Returns the offending property names, which is what the assertions read. */
async function failingProps(cls: new () => object, payload: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
}

const ONE_OFF = {
  team_id: '11111111-1111-4111-8111-111111111111',
  title: 'Wednesday practice',
  starts_at: '2026-09-23T21:00:00.000Z',
  ends_at: '2026-09-23T22:30:00.000Z',
};

const SERIES = {
  team_id: '11111111-1111-4111-8111-111111111111',
  title: 'Fall block practice',
  recurrence: {
    weekdays: [3, 5, 0],
    start_time: '17:00',
    duration_minutes: 90,
    start_date: '2026-09-23',
    end_date: '2026-12-13',
  },
};

describe('CreateEventDto', () => {
  it('accepts a one-off with explicit instants', async () => {
    expect(await failingProps(CreateEventDto, ONE_OFF)).toEqual([]);
  });

  it('accepts a recurring series with no explicit instants', async () => {
    expect(await failingProps(CreateEventDto, SERIES)).toEqual([]);
  });

  /** A zero-length or inverted practice is a malformed request, and the 400 should
   * name the field rather than surfacing later as a confusing empty calendar row. */
  it('rejects ends_at at or before starts_at', async () => {
    expect(
      await failingProps(CreateEventDto, { ...ONE_OFF, ends_at: ONE_OFF.starts_at }),
    ).toEqual(['ends_at']);

    expect(
      await failingProps(CreateEventDto, {
        ...ONE_OFF,
        ends_at: '2026-09-23T20:00:00.000Z',
      }),
    ).toEqual(['ends_at']);
  });

  it('requires instants when there is no recurrence', async () => {
    const { starts_at, ends_at, ...withoutTimes } = ONE_OFF;
    expect(await failingProps(CreateEventDto, withoutTimes)).toEqual(['ends_at', 'starts_at']);
  });

  /** ⚠️ An open-ended series is the thing this feature cannot support: occurrences
   * are materialized, so "forever" means either an infinite insert or a top-up job
   * the backend has no scheduler for. The end date is required, and it is required
   * *here* so the failure is a named 400 rather than a surprise. */
  it('requires an end date on a recurrence', async () => {
    const { end_date, ...openEnded } = SERIES.recurrence;
    expect(
      await failingProps(CreateEventDto, { ...SERIES, recurrence: openEnded }),
    ).toEqual(['recurrence']);
  });

  it('rejects a weekday outside 0-6', async () => {
    expect(
      await failingProps(CreateEventDto, {
        ...SERIES,
        recurrence: { ...SERIES.recurrence, weekdays: [7] },
      }),
    ).toEqual(['recurrence']);
  });

  it('rejects an empty weekday list', async () => {
    expect(
      await failingProps(CreateEventDto, {
        ...SERIES,
        recurrence: { ...SERIES.recurrence, weekdays: [] },
      }),
    ).toEqual(['recurrence']);
  });

  it('rejects a duplicated weekday', async () => {
    expect(
      await failingProps(CreateEventDto, {
        ...SERIES,
        recurrence: { ...SERIES.recurrence, weekdays: [3, 3] },
      }),
    ).toEqual(['recurrence']);
  });

  it('rejects a start_time that is not HH:MM', async () => {
    expect(
      await failingProps(CreateEventDto, {
        ...SERIES,
        recurrence: { ...SERIES.recurrence, start_time: '5pm' },
      }),
    ).toEqual(['recurrence']);
  });

  it('rejects a start_date that is not YYYY-MM-DD', async () => {
    expect(
      await failingProps(CreateEventDto, {
        ...SERIES,
        recurrence: { ...SERIES.recurrence, start_date: '23-09-2026' },
      }),
    ).toEqual(['recurrence']);
  });

  it('rejects an unknown body field', async () => {
    expect(await failingProps(CreateEventDto, { ...ONE_OFF, coach_id: 'x' })).toContain(
      'coach_id',
    );
  });
});

describe('UpdateEventDto', () => {
  it('accepts a title-only edit', async () => {
    expect(await failingProps(UpdateEventDto, { title: 'Moved to the annex' })).toEqual([]);
  });

  it('still rejects an inverted time pair', async () => {
    expect(
      await failingProps(UpdateEventDto, {
        starts_at: '2026-09-23T22:00:00.000Z',
        ends_at: '2026-09-23T21:00:00.000Z',
      }),
    ).toEqual(['ends_at']);
  });
});

describe('EventQueryDto', () => {
  it('accepts a team and a window', async () => {
    expect(
      await failingProps(EventQueryDto, {
        team_id: '11111111-1111-4111-8111-111111111111',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-12-31T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  /** An unbounded read of a team's whole history is not a screen anyone is
   * building, and making it impossible is cheaper than making it fast. */
  it('requires the window', async () => {
    expect(
      await failingProps(EventQueryDto, { team_id: '11111111-1111-4111-8111-111111111111' }),
    ).toEqual(['from', 'to']);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/dto/event.dto.spec.ts
```

Expected: FAIL — `Cannot find module './event.dto'`.

- [ ] **Step 8: Write the event DTOs**

Create `backend/src/teams/dto/event.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsAfter } from './validators';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** A recurrence rule, in the team's local wall-clock terms.
 *
 * Deliberately **not** absolute instants. A coach says "Wednesdays at 5" and
 * means 5pm local on every one of them; expressing that as instants up front is
 * what makes a series drift an hour when the zone changes. The service resolves
 * each occurrence against `teams.timezone` — see `service/recurrence.ts`.
 */
export class RecurrenceDto {
  /** 0 = Sunday .. 6 = Saturday. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays: number[];

  @Matches(HH_MM, { message: 'start_time must be HH:MM in the team timezone' })
  start_time: string;

  @IsInt()
  @Min(5)
  @Max(600)
  duration_minutes: number;

  @Matches(YYYY_MM_DD, { message: 'start_date must be YYYY-MM-DD' })
  start_date: string;

  /** Required, not optional. Occurrences are materialized rather than computed,
   * so an open-ended series would mean either an unbounded insert or a top-up job
   * this backend has no scheduler for. Requiring the date turns that into a named
   * 400. In practice it is the last week of the training block or semester. */
  @Matches(YYYY_MM_DD, { message: 'end_date must be YYYY-MM-DD' })
  end_date: string;
}

/** Body for `POST /events` — one practice, or a whole series.
 *
 * Two shapes in one DTO: either `starts_at`/`ends_at` for a one-off, or
 * `recurrence` for a series. `ValidateIf` is what lets the instants be absent when
 * a recurrence is present without making them optional in the one-off case, where
 * their absence is a real error.
 */
export class CreateEventDto {
  @IsUUID()
  team_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ValidateIf((dto: CreateEventDto) => !dto.recurrence)
  @IsDateString()
  starts_at?: string;

  @ValidateIf((dto: CreateEventDto) => !dto.recurrence)
  @IsDateString()
  @IsAfter('starts_at')
  ends_at?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;
}

/** Body for `PATCH /events/:eventId`.
 *
 * Note there is no `status`. Cancelling goes through `POST /events/:id/cancel` so
 * it is one auditable call and cannot happen as a side effect of renaming.
 */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  starts_at?: string;

  @ValidateIf((dto: UpdateEventDto) => dto.starts_at !== undefined || dto.ends_at !== undefined)
  @IsDateString()
  @IsAfter('starts_at')
  ends_at?: string;
}

/** Query for `GET /events`. The window is **required** — an unbounded read of a
 * team's whole history is not a screen anyone is building, and forbidding it is
 * cheaper than making it fast. */
export class EventQueryDto {
  @IsUUID()
  team_id: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

/** Query for `PATCH /events/:eventId`.
 *
 * `all` is deliberately absent: editing occurrences that already happened
 * rewrites history, and no screen asks for it.
 */
export class UpdateScopeQueryDto {
  @IsOptional()
  @IsIn(['this', 'future'])
  scope?: 'this' | 'future';
}

/** Body for `POST /events/:eventId/participants`. */
export class AddParticipantDto {
  @IsUUID()
  user_id: string;
}
```

- [ ] **Step 9: Run the event DTO tests to verify they pass**

```bash
cd backend && npx jest src/teams/dto/event.dto.spec.ts
```

Expected: PASS, 15 tests. If `requires instants when there is no recurrence` fails with only one property, check that `@ValidateIf` is applied to **both** `starts_at` and `ends_at`.

- [ ] **Step 10: Lint and type-check**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add backend/src/teams/dto
git commit -m "Validate team and practice event payloads, and reject DST-less zones"
```

---

### Task 5: Teams service, controller and module

**Files:**
- Create: `backend/src/teams/service/teams.service.ts`
- Create: `backend/src/teams/controller/teams.controller.ts`
- Create: `backend/src/teams/teams.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/teams/service/teams.service.spec.ts`

**Interfaces:**
- Consumes: `assertReadableTeam`, `assertManageableTeam`, `TeamRole` from `./team-access` (Task 3); `CreateTeamDto`, `UpdateTeamDto` from `../dto/team.dto` (Task 4); `teams`, `teamMembers`, `coaches`, `users` from `src/db/schema` (Task 1).
- Produces:
  - `interface TeamSummary { id: string; name: string; timezone: string; created_at: Date; role: TeamRole }`
  - `interface TeamMemberView { user_id: string; role: TeamRole; first_name: string | null; last_name: string | null; username: string | null; avatar_url: string | null }`
  - `interface TeamDetail extends TeamSummary { members: TeamMemberView[] }`
  - `class TeamsService` with `createTeam`, `listTeams`, `getTeam`, `updateTeam` (membership methods land in Task 6)
  - `class TeamsModule`

Membership routes are deliberately **not** in this task — they carry their own rule (an athlete must already be on the caller's roster) and deserve their own reviewer gate.

- [ ] **Step 1: Write the failing service tests**

Create `backend/src/teams/service/teams.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { TeamsService } from './teams.service';

const TEAM = '11111111-1111-4111-8111-111111111111';
const COACH = '33333333-3333-4333-8333-333333333333';
const ATHLETE = '55555555-5555-4555-8555-555555555555';
const STRANGER = '66666666-6666-4666-8666-666666666666';

const teamRow = {
  id: TEAM,
  name: 'Northeastern Powerlifting',
  timezone: 'America/New_York',
  created_at: new Date('2026-09-22T00:00:00.000Z'),
};

async function build(script: Parameters<typeof makeTestDb>[0]) {
  const harness: TestDb = makeTestDb(script);

  const moduleRef = await Test.createTestingModule({
    providers: [TeamsService, { provide: DRIZZLE, useValue: harness.db }],
  }).compile();

  return { service: moduleRef.get(TeamsService), harness };
}

describe('TeamsService.createTeam', () => {
  const dto = { name: 'Northeastern Powerlifting', timezone: 'America/New_York' };

  it('creates the team and the creator as its first coach, in one transaction', async () => {
    const { service, harness } = await build({
      coaches: [[{ id: COACH }]],
      teams: [[teamRow]],
    });

    const result = await service.createTeam(dto, COACH);

    expect(result.role).toBe('coach');
    expect(result.id).toBe(TEAM);
    expect(harness.transactions).toBe(1);
    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      'insert:teams',
      'insert:team_members',
    ]);
  });

  /** The creating coach comes from the token, never the body. The DTO has no
   * created_by field at all, and this pins that the service uses the caller. */
  it('attributes the team to the caller', async () => {
    const { service, harness } = await build({
      coaches: [[{ id: COACH }]],
      teams: [[teamRow]],
    });

    await service.createTeam(dto, COACH);

    expect(harness.writes[0].values).toMatchObject({ createdBy: COACH });
    expect(harness.writes[1].values).toMatchObject({ userId: COACH, role: 'coach' });
  });

  /** `teams.created_by` references `coaches`, so a caller with no coaches row
   * would fail on the foreign key as a 500. Checking first turns that into a
   * meaningful 403. */
  it('rejects a caller with no coaches row', async () => {
    const { service } = await build({ coaches: [[]] });

    await expect(service.createTeam(dto, ATHLETE)).rejects.toThrow(ForbiddenException);
  });
});

describe('TeamsService.listTeams', () => {
  it('returns the caller teams with their role on each', async () => {
    const { service } = await build({
      team_members: [[{ ...teamRow, role: 'athlete' }]],
    });

    await expect(service.listTeams(ATHLETE)).resolves.toEqual([
      { ...teamRow, role: 'athlete' },
    ]);
  });

  it('returns an empty list for someone on no teams', async () => {
    const { service } = await build({});

    await expect(service.listTeams(STRANGER)).resolves.toEqual([]);
  });
});

describe('TeamsService.getTeam', () => {
  const member = {
    user_id: ATHLETE,
    role: 'athlete' as const,
    first_name: 'Sam',
    last_name: 'Reyes',
    username: 'samr',
    avatar_url: null,
  };

  /** ⚠️ Note the TWO `team_members` script entries. The first is consumed by
   * `assertReadableTeam`, the second by the member list. The mock keys results by
   * table and serves them in order, so a spec that scripts one gets an empty
   * member list and a confusing failure. */
  it('returns the team with its full roster for an athlete member', async () => {
    const { service } = await build({
      team_members: [[{ role: 'athlete' }], [member]],
      teams: [[teamRow]],
    });

    const result = await service.getTeam(TEAM, ATHLETE);

    expect(result).toEqual({ ...teamRow, role: 'athlete', members: [member] });
  });

  /** Athletes see the whole roster, deliberately. At a 50-person co-located squad
   * this is already common knowledge, and hiding it makes the calendar feel
   * broken. What stays hidden is anything user-owned: programming and maxes are
   * still governed by coach_athlete_relationships. */
  it('does not hide members from an athlete', async () => {
    const { service } = await build({
      team_members: [[{ role: 'athlete' }], [member, { ...member, user_id: COACH, role: 'coach' }]],
      teams: [[teamRow]],
    });

    const result = await service.getTeam(TEAM, ATHLETE);

    expect(result.members).toHaveLength(2);
  });

  it('throws 404 for a non-member', async () => {
    const { service } = await build({ teams: [[teamRow]] });

    await expect(service.getTeam(TEAM, STRANGER)).rejects.toThrow(NotFoundException);
  });
});

describe('TeamsService.updateTeam', () => {
  it('lets a coach rename the team', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }]],
      teams: [[{ ...teamRow, name: 'NU Powerlifting' }]],
    });

    const result = await service.updateTeam(TEAM, { name: 'NU Powerlifting' }, COACH);

    expect(result.name).toBe('NU Powerlifting');
    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toEqual(['update:teams']);
  });

  it('throws 403 for an athlete member', async () => {
    const { service } = await build({ team_members: [[{ role: 'athlete' }]] });

    await expect(service.updateTeam(TEAM, { name: 'Mine now' }, ATHLETE)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws 404 for a non-member', async () => {
    const { service } = await build({});

    await expect(service.updateTeam(TEAM, { name: 'Mine now' }, STRANGER)).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/teams.service.spec.ts
```

Expected: FAIL — `Cannot find module './teams.service'`.

- [ ] **Step 3: Write the service**

Create `backend/src/teams/service/teams.service.ts`:

```ts
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { coaches, teamMembers, teams, users } from 'src/db/schema';
import { CreateTeamDto, UpdateTeamDto } from '../dto/team.dto';
import { assertManageableTeam, assertReadableTeam, type TeamRole } from './team-access';

/** A team as the API reports it, with the caller's own role folded in so the
 * client does not have to search the member list to find itself. */
export interface TeamSummary {
  id: string;
  name: string;
  timezone: string;
  created_at: Date;
  role: TeamRole;
}

export interface TeamMemberView {
  user_id: string;
  role: TeamRole;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMemberView[];
}

@Injectable()
export class TeamsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Creates a team and makes the caller its first coach.
   *
   * The two inserts are one transaction on purpose: a team with no coach is
   * unmanageable by anyone, and a half-applied create would leave exactly that.
   *
   * The coaches-row check is not ceremony. `teams.created_by` references
   * `coaches`, so a caller without one fails on the foreign key — a 500 that
   * tells them nothing.
   */
  async createTeam(dto: CreateTeamDto, callerId: string): Promise<TeamSummary> {
    const [coach] = await this.db
      .select({ id: coaches.id })
      .from(coaches)
      .where(eq(coaches.id, callerId))
      .limit(1);

    if (!coach) {
      throw new ForbiddenException('Only a coach can create a team');
    }

    return this.db.transaction(async (tx) => {
      const [team] = await tx
        .insert(teams)
        .values({ name: dto.name, timezone: dto.timezone, createdBy: callerId })
        .returning({
          id: teams.id,
          name: teams.name,
          timezone: teams.timezone,
          created_at: teams.createdAt,
        });

      await tx.insert(teamMembers).values({
        teamId: team.id,
        userId: callerId,
        role: 'coach',
      });

      return { ...team, role: 'coach' as const };
    });
  }

  /** Every team the caller belongs to, either role.
   *
   * Starts from `team_members` rather than `teams` because that is the side with
   * the `user_id` index, and it is the only side that can answer "mine".
   */
  async listTeams(callerId: string): Promise<TeamSummary[]> {
    return this.db
      .select({
        id: teams.id,
        name: teams.name,
        timezone: teams.timezone,
        created_at: teams.createdAt,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, callerId))
      .orderBy(asc(teams.name));
  }

  /** A team and its full roster.
   *
   * Athletes see every member, deliberately — see docs/AUTHORIZATION.md. At a
   * co-located squad the roster is already common knowledge, and a team you
   * cannot see the members of is a strange product. What athletes still cannot
   * reach is anything user-owned: programming and maxes remain governed by
   * `coach_athlete_relationships`, untouched by team membership.
   */
  async getTeam(teamId: string, callerId: string): Promise<TeamDetail> {
    const role = await assertReadableTeam(this.db, teamId, callerId);

    const [team] = await this.db
      .select({
        id: teams.id,
        name: teams.name,
        timezone: teams.timezone,
        created_at: teams.createdAt,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    // A membership row pointing at a missing team should be impossible — the
    // foreign key forbids it — so this is a guard against corruption, not a case
    // a caller can provoke.
    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} could not be found`);
    }

    const members = await this.db
      .select({
        user_id: teamMembers.userId,
        role: teamMembers.role,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(asc(teamMembers.role), asc(users.lastName));

    return { ...team, role, members };
  }

  /** Renames a team or corrects its timezone. Any coach of the team may.
   *
   * ⚠️ Changing `timezone` does **not** move existing events. Their `starts_at`
   * values are already absolute instants, so they stay at the same moment in time
   * and simply render differently. That is the correct behaviour for a team that
   * moved gym, and the wrong one for a typo — in which case the coach edits the
   * affected events. Do not "fix" this by rewriting event rows: silently shifting
   * a semester of practices is far worse than the confusion it would solve.
   */
  async updateTeam(teamId: string, dto: UpdateTeamDto, callerId: string): Promise<TeamSummary> {
    await assertManageableTeam(this.db, teamId, callerId);

    const [team] = await this.db
      .update(teams)
      .set({
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
      })
      .where(eq(teams.id, teamId))
      .returning({
        id: teams.id,
        name: teams.name,
        timezone: teams.timezone,
        created_at: teams.createdAt,
      });

    // The caller passed assertManageableTeam, so they are a coach of this team.
    return { ...team, role: 'coach' as const };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/teams.service.spec.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Write the controller**

Create `backend/src/teams/controller/teams.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { CreateTeamDto, UpdateTeamDto } from '../dto/team.dto';
import { TeamsService } from '../service/teams.service';

/** Teams: a named group of athletes and coaches, and the scope a practice
 * calendar belongs to.
 *
 * A team grants **nothing** beyond calendar scope and roster visibility.
 * Programming, messaging and roster authorization stay on
 * `coach_athlete_relationships` — see `service/team-access.ts`.
 *
 * There is no `DELETE /teams`. Deleting a team with events and participant rows
 * is a cascade decision nobody needs yet, and docs/ROADMAP.md already records
 * "no way to end a relationship" as a hole — leaving it visibly absent beats
 * half-building it.
 */
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateTeamDto, @Req() req: RequestWithUser) {
    return this.teamsService.createTeam(dto, req.user.id);
  }

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: RequestWithUser) {
    return this.teamsService.listTeams(req.user.id);
  }

  @Get(':teamId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async get(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.teamsService.getTeam(teamId, req.user.id);
  }

  /** PATCH rather than PUT: every update in this codebase is a PATCH, and
   * `frontend/lib/api/client.ts` exposes no `put`. */
  @Patch(':teamId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() dto: UpdateTeamDto,
    @Req() req: RequestWithUser,
  ) {
    return this.teamsService.updateTeam(teamId, dto, req.user.id);
  }
}
```

`ParseUUIDPipe` on the path param is what turns a malformed id into a 400 rather than a Postgres error surfacing as a 500 — a bug this repo has already shipped once.

- [ ] **Step 6: Write the module and wire it in**

Create `backend/src/teams/teams.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { TeamsController } from './controller/teams.controller';
import { TeamsService } from './service/teams.service';

/** Teams and practice events.
 *
 * SupabaseModule is imported only because JwtAuthGuard verifies tokens against
 * Supabase Auth. No data in this module touches Supabase — same reason
 * ProgrammingModule imports it.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
```

Then in `backend/src/app.module.ts`, add the import beside the other feature modules:

```ts
import { TeamsModule } from './teams/teams.module';
```

and add `TeamsModule,` to the `imports` array, after `ProgrammingModule,`.

- [ ] **Step 7: Verify the app still boots**

```bash
cd backend && npx tsc --noEmit && npm run build && npm test
```

Expected: type-check clean, build clean, the whole existing suite still green. A missing provider or a circular import shows up here rather than at runtime.

- [ ] **Step 8: Smoke-test the routes against the local database**

```bash
cd backend && npm run start:dev
```

In another shell, confirm the routes are registered — an unauthenticated call should be a 401 from `JwtAuthGuard`, not a 404:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/teams
```

Expected: `401`. A `404` means the module is not wired into `app.module.ts`.

- [ ] **Step 9: Lint and commit**

```bash
cd backend && npm run lint
git add backend/src/teams backend/src/app.module.ts
git commit -m "Create and read teams"
```

---

### Task 6: Team membership

**Files:**
- Modify: `backend/src/teams/service/teams.service.ts`
- Modify: `backend/src/teams/controller/teams.controller.ts`
- Test: `backend/src/teams/service/teams.service.spec.ts` (append)

**Interfaces:**
- Consumes: `isActiveCoachOf` from `src/programming/service/programming-access` — **imported, not reimplemented**; `TeamMemberView` from Task 5.
- Produces: `TeamsService.addMember(teamId: string, dto: AddTeamMemberDto, callerId: string): Promise<TeamMemberView>` and `TeamsService.removeMember(teamId: string, userId: string, callerId: string): Promise<void>`.

This carries the rule that substitutes for an invite-and-accept flow, so it is its own task.

- [ ] **Step 1: Append the failing tests**

Add to `backend/src/teams/service/teams.service.spec.ts`:

```ts
describe('TeamsService.addMember', () => {
  const addedMember = {
    user_id: ATHLETE,
    role: 'athlete' as const,
    first_name: 'Sam',
    last_name: 'Reyes',
    username: 'samr',
    avatar_url: null,
  };

  /** ⚠️ **This is what replaces an accept/reject step.** Consent already happened
   * when the athlete accepted this coach, so a coach adds from their own roster
   * and nobody can be added to a team by a stranger. */
  it('adds an athlete the caller actively coaches', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [addedMember]],
      coach_athlete_relationships: [[{ id: 'rel' }]],
    });

    const result = await service.addMember(TEAM, { user_id: ATHLETE, role: 'athlete' }, COACH);

    expect(result).toEqual(addedMember);
    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toContain('insert:team_members');
  });

  /** 404 rather than 403, and with the same message `assertReadableAthlete`
   * produces. Athlete ids come from `/athlete/search`, so a 403 here would answer
   * "is this person on your roster" for any id a caller tries. */
  it('rejects an athlete the caller does not coach, with a 404', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }]],
      coach_athlete_relationships: [[]],
    });

    await expect(
      service.addMember(TEAM, { user_id: STRANGER, role: 'athlete' }, COACH),
    ).rejects.toThrow(NotFoundException);
  });

  /** A pending relationship is an unaccepted invite. Treating it as access would
   * mean sending an invite is enough to put someone on your team — the invite
   * exploit wearing a different hat. `isActiveCoachOf` filters on status already;
   * this pins that this path uses it rather than a looser check of its own. */
  it('does not accept a pending relationship as consent', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }]],
      coach_athlete_relationships: [[]],
    });

    await expect(
      service.addMember(TEAM, { user_id: ATHLETE, role: 'athlete' }, COACH),
    ).rejects.toThrow(NotFoundException);
  });

  /** Coaches have no pairwise relationship to check, so adding one needs no
   * relationship — only that the target really is a coach. With co-coaches this
   * is how a second coach joins and brings their own athletes. */
  it('adds a coach with no relationship check, but requires a coaches row', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }], [{ ...addedMember, user_id: COACH_B, role: 'coach' }]],
      coaches: [[{ id: COACH_B }]],
    });

    const result = await service.addMember(TEAM, { user_id: COACH_B, role: 'coach' }, COACH);

    expect(result.role).toBe('coach');
  });

  it('rejects adding a coach who has no coaches row', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }]],
      coaches: [[]],
    });

    await expect(
      service.addMember(TEAM, { user_id: ATHLETE, role: 'coach' }, COACH),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 403 when an athlete member tries to add someone', async () => {
    const { service } = await build({ team_members: [[{ role: 'athlete' }]] });

    await expect(
      service.addMember(TEAM, { user_id: STRANGER, role: 'athlete' }, ATHLETE),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('TeamsService.removeMember', () => {
  it('removes a member and deletes only the membership row', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ role: 'athlete' }]],
    });

    await service.removeMember(TEAM, ATHLETE, COACH);

    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toEqual(['delete:team_members']);
  });

  /** ⚠️ **Participant rows outlive membership, on purpose.** They record that a
   * person was at a practice — training history, not membership — and the video
   * spec will hang submissions off them. A cascade here would delete a departed
   * athlete's video evidence along with their name. */
  it('leaves event_participants untouched', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ role: 'athlete' }]],
    });

    await service.removeMember(TEAM, ATHLETE, COACH);

    expect(harness.writes.map((w) => w.table)).not.toContain('event_participants');
  });

  /** A team whose last coach leaves cannot be managed by anyone: no one can add
   * members, create events or cancel them, and there is no DELETE /teams to clean
   * it up. Cheaper to forbid than to build a recovery path. */
  it('refuses to remove the last coach', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }], [{ role: 'coach' }], [{ userId: COACH }]],
    });

    await expect(service.removeMember(TEAM, COACH, COACH)).rejects.toThrow(ConflictException);
  });

  it('throws 404 when the target is not on the team', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }], []],
    });

    await expect(service.removeMember(TEAM, STRANGER, COACH)).rejects.toThrow(NotFoundException);
  });

  it('throws 403 when an athlete member tries to remove someone', async () => {
    const { service } = await build({ team_members: [[{ role: 'athlete' }]] });

    await expect(service.removeMember(TEAM, COACH, ATHLETE)).rejects.toThrow(ForbiddenException);
  });
});
```

Add `ConflictException` to the `@nestjs/common` import at the top of the spec, and add the constant:

```ts
const COACH_B = '77777777-7777-4777-8777-777777777777';
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/teams.service.spec.ts
```

Expected: FAIL — `service.addMember is not a function`.

- [ ] **Step 3: Implement the two methods**

Add to the `@nestjs/common` import in `teams.service.ts`: `ConflictException`. Add to the drizzle import: `and`. Add these imports:

```ts
import { isActiveCoachOf } from 'src/programming/service/programming-access';
import { AddTeamMemberDto } from '../dto/team.dto';
```

Then add to `TeamsService`:

```ts
  /** Puts someone on a team.
   *
   * ⚠️ **This is what stands in for an invite-and-accept flow.** An athlete may
   * only be added by a coach who is *already* in an active relationship with
   * them, so the consent that matters happened when the athlete accepted that
   * coach. That buys a real property: nobody can be put on a team by a stranger,
   * and there is no second notification type to build.
   *
   * `isActiveCoachOf` is imported from the programming module rather than
   * reimplemented. It already excludes `pending` relationships — an unaccepted
   * invite must not count as access, or sending one becomes enough to add someone
   * to your team.
   *
   * Coaches are added with no relationship check, because coaches have no
   * pairwise relationship to check. With co-coaches this is the path by which a
   * second coach joins and contributes their own athletes.
   */
  async addMember(
    teamId: string,
    dto: AddTeamMemberDto,
    callerId: string,
  ): Promise<TeamMemberView> {
    await assertManageableTeam(this.db, teamId, callerId);

    if (dto.role === 'athlete') {
      if (!(await isActiveCoachOf(this.db, callerId, dto.user_id))) {
        // Deliberately the same 404 and the same wording assertReadableAthlete
        // uses. Athlete ids are handed out by /athlete/search, so a 403 would
        // answer "is this person on your roster?" for any id a caller tries.
        throw new NotFoundException(`Athlete with ID ${dto.user_id} could not be found`);
      }
    } else {
      const [coach] = await this.db
        .select({ id: coaches.id })
        .from(coaches)
        .where(eq(coaches.id, dto.user_id))
        .limit(1);

      if (!coach) {
        throw new NotFoundException(`Coach with ID ${dto.user_id} could not be found`);
      }
    }

    await this.db.insert(teamMembers).values({
      teamId,
      userId: dto.user_id,
      role: dto.role,
    });

    const [member] = await this.db
      .select({
        user_id: teamMembers.userId,
        role: teamMembers.role,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, dto.user_id)))
      .limit(1);

    return member;
  }

  /** Takes someone off a team.
   *
   * A real delete, not a soft one. A `left_at` column would mean every membership
   * query grows a `WHERE left_at IS NULL` that is easy to forget — and in a
   * codebase where the API is the entire trust boundary, a forgotten filter means
   * a removed member keeps reading the calendar.
   *
   * ⚠️ **`event_participants` is deliberately left alone.** Those rows record
   * that a person was at a practice, which is training history rather than
   * membership, and the video spec will hang submissions off them. A cascade here
   * would delete a departed athlete's evidence along with their name. The visible
   * consequence is that a removed athlete stays listed on a future practice; see
   * open question 2 in the design doc.
   */
  async removeMember(teamId: string, userId: string, callerId: string): Promise<void> {
    await assertManageableTeam(this.db, teamId, callerId);

    const [target] = await this.db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .limit(1);

    if (!target) {
      throw new NotFoundException(`Team member with ID ${userId} could not be found`);
    }

    if (target.role === 'coach') {
      const remainingCoaches = await this.db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'coach')));

      // A team whose last coach leaves can never be managed again: nobody can add
      // members, create events or cancel them, and there is no DELETE /teams to
      // clean it up. Forbidding this is much cheaper than a recovery path.
      if (remainingCoaches.length <= 1) {
        throw new ConflictException('A team must keep at least one coach');
      }
    }

    await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/teams.service.spec.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 5: Add the two routes**

Add to `backend/src/teams/controller/teams.controller.ts` — `Delete` to the `@nestjs/common` import, and `AddTeamMemberDto` to the dto import:

```ts
  @Post(':teamId/members')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async addMember(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() dto: AddTeamMemberDto,
    @Req() req: RequestWithUser,
  ) {
    return this.teamsService.addMember(teamId, dto, req.user.id);
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async removeMember(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: RequestWithUser,
  ) {
    await this.teamsService.removeMember(teamId, userId, req.user.id);
  }
```

- [ ] **Step 6: Verify the gates**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
```

Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/teams
git commit -m "Add and remove team members, from the coach's own roster"
```

---

### Task 7: Create events, one-off and recurring

**Files:**
- Create: `backend/src/teams/service/events.service.ts`
- Create: `backend/src/teams/controller/events.controller.ts`
- Modify: `backend/src/teams/teams.module.ts`
- Test: `backend/src/teams/service/events.service.spec.ts`

**Interfaces:**
- Consumes: `expandSeries`, `RecurrenceRule` from `./recurrence` (Task 2); `assertManageableTeam`, `assertReadableTeam`, `loadReadableEvent`, `loadManageableEvent` from `./team-access` (Task 3); `CreateEventDto` from `../dto/event.dto` (Task 4).
- Produces:
  - `interface EventView { id: string; team_id: string; series_id: string | null; title: string; starts_at: Date; ends_at: Date; location: string | null; notes: string | null; status: 'scheduled' | 'canceled'; created_by: string }`
  - `interface EventParticipantView { user_id: string; first_name: string | null; last_name: string | null; username: string | null; avatar_url: string | null }`
  - `interface EventDetail extends EventView { participants: EventParticipantView[] }`
  - `class EventsService` with `createEvent(dto: CreateEventDto, callerId: string): Promise<EventView[]>`. Reads land in Task 8, writes in Tasks 9 and 10.

`createEvent` always returns an **array**, even for a one-off. A single-element array is less surprising than a response whose shape depends on the request.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/teams/service/events.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { EventsService } from './events.service';

const TEAM = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const COACH = '33333333-3333-4333-8333-333333333333';
const ATHLETE_A = '55555555-5555-4555-8555-555555555555';
const ATHLETE_B = '77777777-7777-4777-8777-777777777777';
const STRANGER = '66666666-6666-4666-8666-666666666666';

const NY_TEAM = [{ timezone: 'America/New_York' }];

const eventRow = {
  id: EVENT,
  team_id: TEAM,
  series_id: null,
  title: 'Wednesday practice',
  starts_at: new Date('2026-09-23T21:00:00.000Z'),
  ends_at: new Date('2026-09-23T22:30:00.000Z'),
  location: 'Marino Center',
  notes: null,
  status: 'scheduled' as const,
  created_by: COACH,
};

async function build(script: Parameters<typeof makeTestDb>[0]) {
  const harness: TestDb = makeTestDb(script);

  const moduleRef = await Test.createTestingModule({
    providers: [EventsService, { provide: DRIZZLE, useValue: harness.db }],
  }).compile();

  return { service: moduleRef.get(EventsService), harness };
}

const ONE_OFF = {
  team_id: TEAM,
  title: 'Wednesday practice',
  starts_at: '2026-09-23T21:00:00.000Z',
  ends_at: '2026-09-23T22:30:00.000Z',
};

const SERIES = {
  team_id: TEAM,
  title: 'Fall block practice',
  recurrence: {
    weekdays: [3],
    start_time: '17:00',
    duration_minutes: 90,
    start_date: '2026-10-28',
    end_date: '2026-11-04',
  },
};

describe('EventsService.createEvent', () => {
  it('creates a one-off event and returns it in an array', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ userId: ATHLETE_A }]],
      teams: [NY_TEAM],
      events: [[eventRow]],
    });

    const result = await service.createEvent(ONE_OFF, COACH);

    expect(result).toEqual([eventRow]);
    expect(harness.transactions).toBe(1);
  });

  it('pre-fills participants with every current team athlete', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ userId: ATHLETE_A }, { userId: ATHLETE_B }]],
      teams: [NY_TEAM],
      events: [[eventRow]],
    });

    await service.createEvent(ONE_OFF, COACH);

    const participantInsert = harness.writes.find(
      (w) => w.table === 'event_participants' && w.op === 'insert',
    );
    expect(participantInsert?.values).toEqual([
      { eventId: EVENT, userId: ATHLETE_A },
      { eventId: EVENT, userId: ATHLETE_B },
    ]);
  });

  /** Coaches are not participants. A coach reviewing the session is not someone
   * who lifted at it, and the video spec will treat a participant row as "this
   * person trained here". */
  it('does not add coaches as participants', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ userId: ATHLETE_A }]],
      teams: [NY_TEAM],
      events: [[eventRow]],
    });

    await service.createEvent(ONE_OFF, COACH);

    const participantInsert = harness.writes.find((w) => w.table === 'event_participants');
    expect(participantInsert?.values).toEqual([{ eventId: EVENT, userId: ATHLETE_A }]);
  });

  /** Drizzle throws on an empty `values([])`, so a team with no athletes yet must
   * skip the insert rather than issue it. A coach creating the calendar before
   * adding the roster is the normal order of operations, not an edge case. */
  it('skips the participant insert when the team has no athletes', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], []],
      teams: [NY_TEAM],
      events: [[eventRow]],
    });

    await service.createEvent(ONE_OFF, COACH);

    expect(harness.writes.map((w) => w.table)).not.toContain('event_participants');
  });

  it('expands a recurring series into one row per occurrence, sharing a series id', async () => {
    const seriesRows = [
      { ...eventRow, id: 'e1', series_id: 's1' },
      { ...eventRow, id: 'e2', series_id: 's1' },
    ];
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], [{ userId: ATHLETE_A }]],
      teams: [NY_TEAM],
      events: [seriesRows],
    });

    const result = await service.createEvent(SERIES, COACH);

    expect(result).toHaveLength(2);

    const eventInsert = harness.writes.find((w) => w.table === 'events' && w.op === 'insert');
    const inserted = eventInsert?.values as Array<{ seriesId: string; startsAt: Date }>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0].seriesId).toBe(inserted[1].seriesId);
    expect(inserted[0].seriesId).toBeTruthy();
  });

  /** ⚠️ The DST guarantee, asserted at the service boundary rather than only in
   * recurrence.spec.ts. This pins that the service actually passes the *team's*
   * timezone through instead of defaulting to UTC or the server's zone — which is
   * the realistic way this regresses. */
  it('resolves occurrences in the team timezone, so a series survives DST', async () => {
    const { service, harness } = await build({
      team_members: [[{ role: 'coach' }], []],
      teams: [NY_TEAM],
      events: [[eventRow, eventRow]],
    });

    await service.createEvent(SERIES, COACH);

    const eventInsert = harness.writes.find((w) => w.table === 'events' && w.op === 'insert');
    const inserted = eventInsert?.values as Array<{ startsAt: Date }>;

    // 17:00 local on both Wednesdays, either side of the 2026-11-01 transition.
    expect(inserted[0].startsAt.toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(inserted[1].startsAt.toISOString()).toBe('2026-11-04T22:00:00.000Z');
  });

  /** A 52-week span is cross-field date math, which a property decorator cannot
   * see — so recurrence.ts raises it and the service must translate it into a 400
   * rather than letting a raw Error become a 500. */
  it('turns an over-long series into a 400, not a 500', async () => {
    const { service } = await build({
      team_members: [[{ role: 'coach' }]],
      teams: [NY_TEAM],
    });

    await expect(
      service.createEvent(
        {
          ...SERIES,
          recurrence: { ...SERIES.recurrence, start_date: '2026-01-01', end_date: '2027-06-01' },
        },
        COACH,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 403 for an athlete member of the team', async () => {
    const { service } = await build({ team_members: [[{ role: 'athlete' }]] });

    await expect(service.createEvent(ONE_OFF, ATHLETE_A)).rejects.toThrow(ForbiddenException);
  });

  it('throws 404 for a caller who is not on the team at all', async () => {
    const { service } = await build({});

    await expect(service.createEvent(ONE_OFF, STRANGER)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: FAIL — `Cannot find module './events.service'`.

- [ ] **Step 3: Write the service**

Create `backend/src/teams/service/events.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { eventParticipants, events, teamMembers, teams } from 'src/db/schema';
import { CreateEventDto } from '../dto/event.dto';
import { expandSeries, type Occurrence } from './recurrence';
import { assertManageableTeam } from './team-access';

/** One practice as the API reports it. */
export interface EventView {
  id: string;
  team_id: string;
  series_id: string | null;
  title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  notes: string | null;
  status: 'scheduled' | 'canceled';
  created_by: string;
}

export interface EventParticipantView {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface EventDetail extends EventView {
  participants: EventParticipantView[];
}

/** The column list every event read returns. Declared once so a new column
 * cannot appear on one endpoint and be missing from another. */
const EVENT_COLUMNS = {
  id: events.id,
  team_id: events.teamId,
  series_id: events.seriesId,
  title: events.title,
  starts_at: events.startsAt,
  ends_at: events.endsAt,
  location: events.location,
  notes: events.notes,
  status: events.status,
  created_by: events.createdBy,
};

@Injectable()
export class EventsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Creates one practice, or a whole series.
   *
   * Always returns an array. A one-off comes back as a single element rather than
   * a bare object, because a response shape that depends on the request shape is
   * a trap for every caller.
   *
   * The events and their participant rows go in **one transaction**: a series
   * half-created, or practices with nobody in them, is worse than a failed
   * request the coach can retry.
   */
  async createEvent(dto: CreateEventDto, callerId: string): Promise<EventView[]> {
    await assertManageableTeam(this.db, dto.team_id, callerId);

    const [team] = await this.db
      .select({ timezone: teams.timezone })
      .from(teams)
      .where(eq(teams.id, dto.team_id))
      .limit(1);

    if (!team) {
      throw new NotFoundException(`Team with ID ${dto.team_id} could not be found`);
    }

    const occurrences = this.resolveOccurrences(dto, team.timezone);
    // Null for a one-off. Generated here rather than in the database because
    // every row of the series needs the *same* value, and a column default
    // cannot express that.
    const seriesId = dto.recurrence ? randomUUID() : null;

    /** Only athletes. A coach reviewing the session is not someone who lifted at
     * it, and the video spec reads a participant row as "this person trained
     * here". */
    const athletes = await this.db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, dto.team_id), eq(teamMembers.role, 'athlete')));

    return this.db.transaction(async (tx) => {
      const created = await tx
        .insert(events)
        .values(
          occurrences.map((occurrence) => ({
            teamId: dto.team_id,
            seriesId,
            title: dto.title,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            location: dto.location ?? null,
            notes: dto.notes ?? null,
            createdBy: callerId,
          })),
        )
        .returning(EVENT_COLUMNS);

      // Drizzle throws on `values([])`, and a coach who builds the calendar
      // before adding the roster is the normal order of operations.
      if (athletes.length > 0) {
        await tx.insert(eventParticipants).values(
          created.flatMap((event) =>
            athletes.map((athlete) => ({ eventId: event.id, userId: athlete.userId })),
          ),
        );
      }

      return created;
    });
  }

  /** A one-off's instants, or a series expanded against the team's zone.
   *
   * `expandSeries` raises a plain `Error` for a rule the DTO cannot check — the
   * 52-week span is cross-field date math no property decorator can see. Left
   * unhandled that becomes a 500, so it is translated here into the 400 it is.
   */
  private resolveOccurrences(dto: CreateEventDto, timeZone: string): Occurrence[] {
    if (!dto.recurrence) {
      // The DTO guarantees both are present and correctly ordered when there is
      // no recurrence.
      return [
        {
          startsAt: new Date(dto.starts_at as string),
          endsAt: new Date(dto.ends_at as string),
        },
      ];
    }

    try {
      return expandSeries(
        {
          weekdays: dto.recurrence.weekdays,
          startTime: dto.recurrence.start_time,
          durationMinutes: dto.recurrence.duration_minutes,
          startDate: dto.recurrence.start_date,
          endDate: dto.recurrence.end_date,
        },
        timeZone,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'The recurrence rule could not be expanded',
      );
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Write the controller and register it**

Create `backend/src/teams/controller/events.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { CreateEventDto } from '../dto/event.dto';
import { EventsService } from '../service/events.service';

/** Practice events: the shared anchor for a training session.
 *
 * Every route authorizes through `service/team-access.ts`. Reading needs team
 * membership; writing needs to be a **coach** of the team — any coach of it, not
 * only the one who created the event. That is the opposite of the workout rule and
 * is deliberate; see the comment in `team-access.ts`.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /** One practice, or a whole series. Returns an array either way. */
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateEventDto, @Req() req: RequestWithUser) {
    return this.eventsService.createEvent(dto, req.user.id);
  }
}
```

Then update `backend/src/teams/teams.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { EventsController } from './controller/events.controller';
import { TeamsController } from './controller/teams.controller';
import { EventsService } from './service/events.service';
import { TeamsService } from './service/teams.service';

@Module({
  imports: [SupabaseModule],
  controllers: [TeamsController, EventsController],
  providers: [TeamsService, EventsService],
})
export class TeamsModule {}
```

Keep the existing doc comment on the class.

- [ ] **Step 6: Verify the gates and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
git add backend/src/teams
git commit -m "Create practice events, one-off and recurring"
```

---

### Task 8: Read events

**Files:**
- Modify: `backend/src/teams/service/events.service.ts`
- Modify: `backend/src/teams/controller/events.controller.ts`
- Test: `backend/src/teams/service/events.service.spec.ts` (append)

**Interfaces:**
- Consumes: `assertReadableTeam`, `loadReadableEvent` from `./team-access`; `EventQueryDto` from `../dto/event.dto`.
- Produces: `EventsService.listEvents(query: EventQueryDto, callerId: string): Promise<EventView[]>` and `EventsService.getEvent(eventId: string, callerId: string): Promise<EventDetail>`.

- [ ] **Step 1: Append the failing tests**

Add to `backend/src/teams/service/events.service.spec.ts`:

```ts
describe('EventsService.listEvents', () => {
  const window = {
    team_id: TEAM,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-12-31T00:00:00.000Z',
  };

  it('returns the team events in the window for any member', async () => {
    const { service } = await build({
      team_members: [[{ role: 'athlete' }]],
      events: [[eventRow]],
    });

    await expect(service.listEvents(window, ATHLETE_A)).resolves.toEqual([eventRow]);
  });

  /** ⚠️ Canceled events are returned, not filtered out. An athlete needs to
   * *learn* a practice is off; an event that silently vanishes is
   * indistinguishable from a bug, and the client renders the status. */
  it('includes canceled events', async () => {
    const canceled = { ...eventRow, id: 'e2', status: 'canceled' as const };
    const { service } = await build({
      team_members: [[{ role: 'athlete' }]],
      events: [[eventRow, canceled]],
    });

    const result = await service.listEvents(window, ATHLETE_A);

    expect(result.map((e) => e.status)).toEqual(['scheduled', 'canceled']);
  });

  it('throws 404 for a caller who is not on the team', async () => {
    const { service } = await build({});

    await expect(service.listEvents(window, STRANGER)).rejects.toThrow(NotFoundException);
  });
});

describe('EventsService.getEvent', () => {
  const participant = {
    user_id: ATHLETE_A,
    first_name: 'Sam',
    last_name: 'Reyes',
    username: 'samr',
    avatar_url: null,
  };

  /** Three `events` / `team_members` script entries between them: loadReadableEvent
   * reads the event then the membership, and then the service reads the full row
   * and the participants. */
  it('returns the event with its participants for a team member', async () => {
    const { service } = await build({
      events: [[eventRow], [eventRow]],
      team_members: [[{ role: 'athlete' }]],
      event_participants: [[participant]],
    });

    const result = await service.getEvent(EVENT, ATHLETE_A);

    expect(result).toEqual({ ...eventRow, participants: [participant] });
  });

  /** A team member who is not in this practice still reads it, participants and
   * all. The calendar is a team artifact. */
  it('does not require the caller to be a participant', async () => {
    const { service } = await build({
      events: [[eventRow], [eventRow]],
      team_members: [[{ role: 'athlete' }]],
      event_participants: [[participant]],
    });

    await expect(service.getEvent(EVENT, ATHLETE_B)).resolves.toMatchObject({ id: EVENT });
  });

  it('throws 404 for a stranger to the team', async () => {
    const { service } = await build({ events: [[eventRow]] });

    await expect(service.getEvent(EVENT, STRANGER)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: FAIL — `service.listEvents is not a function`.

- [ ] **Step 3: Implement the two reads**

Add to the drizzle import in `events.service.ts`: `asc`, `gte`, `lte`. Add to the schema import: `users`. Add to the team-access import: `assertReadableTeam`, `loadReadableEvent`. Add `EventQueryDto` to the dto import.

Then add to `EventsService`:

```ts
  /** The team's calendar for a window.
   *
   * The window is required by the DTO. An unbounded read of a team's whole
   * history is not a screen anyone is building, and forbidding it is cheaper than
   * making it fast.
   *
   * ⚠️ **Canceled events are included.** Filtering them out would make a canceled
   * practice disappear, which an athlete cannot tell apart from a bug — and the
   * whole reason cancellation is a status rather than a delete is so they can see
   * it. The client renders the status.
   *
   * Authorization is the team, checked once, and every row is then scoped to that
   * team id — so there is no per-row check to forget.
   */
  async listEvents(query: EventQueryDto, callerId: string): Promise<EventView[]> {
    await assertReadableTeam(this.db, query.team_id, callerId);

    return this.db
      .select(EVENT_COLUMNS)
      .from(events)
      .where(
        and(
          eq(events.teamId, query.team_id),
          gte(events.startsAt, new Date(query.from)),
          lte(events.startsAt, new Date(query.to)),
        ),
      )
      .orderBy(asc(events.startsAt));
  }

  /** One practice and who is in it.
   *
   * `loadReadableEvent` has already established the caller is a member of this
   * event's team, so the participant read below is scoped by the event id it
   * vouched for and needs no second check.
   */
  async getEvent(eventId: string, callerId: string): Promise<EventDetail> {
    await loadReadableEvent(this.db, eventId, callerId);

    const [event] = await this.db
      .select(EVENT_COLUMNS)
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} could not be found`);
    }

    const participants = await this.db
      .select({
        user_id: eventParticipants.userId,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
      })
      .from(eventParticipants)
      .innerJoin(users, eq(users.id, eventParticipants.userId))
      .where(eq(eventParticipants.eventId, eventId))
      .orderBy(asc(users.lastName));

    return { ...event, participants };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Add the routes**

Add `Get`, `Param`, `ParseUUIDPipe`, `Query` to the `@nestjs/common` import in `events.controller.ts`, and `EventQueryDto` to the dto import:

```ts
  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Query() query: EventQueryDto, @Req() req: RequestWithUser) {
    return this.eventsService.listEvents(query, req.user.id);
  }

  @Get(':eventId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async get(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.eventsService.getEvent(eventId, req.user.id);
  }
```

⚠️ Declare `@Get()` **before** `@Get(':eventId')`. Nest matches in declaration order, and the reverse order makes `/events` resolve as an event whose id is empty.

- [ ] **Step 6: Verify the gates and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
git add backend/src/teams
git commit -m "Read the team calendar and a single practice"
```

---

### Task 9: Edit and cancel events

**Files:**
- Modify: `backend/src/teams/service/events.service.ts`
- Modify: `backend/src/teams/controller/events.controller.ts`
- Test: `backend/src/teams/service/events.service.spec.ts` (append)

**Interfaces:**
- Consumes: `loadManageableEvent` from `./team-access`; `UpdateEventDto`, `UpdateScopeQueryDto` from `../dto/event.dto`.
- Produces: `EventsService.updateEvent(eventId: string, dto: UpdateEventDto, scope: 'this' | 'future', callerId: string): Promise<EventView[]>` and `EventsService.cancelEvent(eventId: string, callerId: string): Promise<EventView>`.

`updateEvent` returns an array because `scope=future` changes many rows.

- [ ] **Step 1: Append the failing tests**

Add to `backend/src/teams/service/events.service.spec.ts`:

```ts
describe('EventsService.updateEvent', () => {
  const seriesEvent = { ...eventRow, series_id: 's1' };

  it('updates only the named event under the default scope', async () => {
    const { service, harness } = await build({
      events: [[seriesEvent], [{ ...seriesEvent, title: 'Moved to the annex' }]],
      team_members: [[{ role: 'coach' }]],
    });

    const result = await service.updateEvent(
      EVENT,
      { title: 'Moved to the annex' },
      'this',
      COACH,
    );

    expect(result).toHaveLength(1);
    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toEqual(['update:events']);
  });

  it('updates the rest of the series under scope=future', async () => {
    const { service } = await build({
      events: [[seriesEvent], [seriesEvent, { ...seriesEvent, id: 'e2' }]],
      team_members: [[{ role: 'coach' }]],
    });

    const result = await service.updateEvent(EVENT, { title: 'Renamed' }, 'future', COACH);

    expect(result).toHaveLength(2);
  });

  /** ⚠️ **The data-destroying edit this rejects.** `starts_at` holds an absolute
   * instant, so writing one value across every future occurrence would collapse
   * the whole series onto a single datetime — a semester of practices stacked on
   * one evening. Moving one practice is scope=this; retiming a series means
   * cancelling it and creating a new one. */
  it('refuses a time change across a series', async () => {
    const { service } = await build({
      events: [[seriesEvent]],
      team_members: [[{ role: 'coach' }]],
    });

    await expect(
      service.updateEvent(EVENT, { starts_at: '2026-10-01T21:00:00.000Z' }, 'future', COACH),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a time change on a single event', async () => {
    const { service } = await build({
      events: [[seriesEvent], [{ ...seriesEvent, starts_at: new Date('2026-09-23T22:00:00.000Z') }]],
      team_members: [[{ role: 'coach' }]],
    });

    await expect(
      service.updateEvent(
        EVENT,
        { starts_at: '2026-09-23T22:00:00.000Z', ends_at: '2026-09-23T23:30:00.000Z' },
        'this',
        COACH,
      ),
    ).resolves.toHaveLength(1);
  });

  /** scope=future on a one-off is a no-op rather than an error: seriesId is null,
   * so there is no series to walk and the single row is the whole answer. */
  it('treats scope=future on a one-off as scope=this', async () => {
    const { service } = await build({
      events: [[eventRow], [eventRow]],
      team_members: [[{ role: 'coach' }]],
    });

    await expect(
      service.updateEvent(EVENT, { title: 'Renamed' }, 'future', COACH),
    ).resolves.toHaveLength(1);
  });

  /** Any coach of the team may edit, including one who did not create the event.
   * eventRow.created_by is COACH; this caller is a different coach of the team. */
  it('allows a coach who did not create the event', async () => {
    const otherCoach = '88888888-8888-4888-8888-888888888888';
    const { service } = await build({
      events: [[eventRow], [eventRow]],
      team_members: [[{ role: 'coach' }]],
    });

    await expect(
      service.updateEvent(EVENT, { title: 'Renamed' }, 'this', otherCoach),
    ).resolves.toHaveLength(1);
  });

  it('throws 403 for an athlete member', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'athlete' }]],
    });

    await expect(
      service.updateEvent(EVENT, { title: 'Mine now' }, 'this', ATHLETE_A),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('EventsService.cancelEvent', () => {
  it('sets the status rather than deleting the row', async () => {
    const { service, harness } = await build({
      events: [[eventRow], [{ ...eventRow, status: 'canceled' as const }]],
      team_members: [[{ role: 'coach' }]],
    });

    const result = await service.cancelEvent(EVENT, COACH);

    expect(result.status).toBe('canceled');
    expect(harness.writes.map((w) => w.op)).toEqual(['update']);
    expect(harness.writes.map((w) => w.op)).not.toContain('delete');
  });

  it('throws 403 for an athlete member', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'athlete' }]],
    });

    await expect(service.cancelEvent(EVENT, ATHLETE_A)).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: FAIL — `service.updateEvent is not a function`.

- [ ] **Step 3: Implement the two writes**

Add `loadManageableEvent` to the team-access import and `UpdateEventDto` to the dto import in `events.service.ts`. Then add to `EventsService`:

```ts
  /** Edits a practice, or the rest of its series.
   *
   * ⚠️ **`scope: 'future'` rejects time changes, and that is load-bearing.**
   * `starts_at` and `ends_at` hold absolute instants. Writing one value across
   * every remaining occurrence would collapse a whole semester of practices onto
   * a single evening — a data-destroying edit dressed up as a convenience. Moving
   * one practice is `scope: 'this'`; retiming a series means cancelling it and
   * creating a new one, where each occurrence gets resolved against the team's
   * zone properly.
   *
   * Only `title`, `location` and `notes` propagate across a series.
   *
   * Any coach of the team may edit any of its events, including one they did not
   * create — see the comment in `team-access.ts`. `created_by` is attribution,
   * not authorization.
   */
  async updateEvent(
    eventId: string,
    dto: UpdateEventDto,
    scope: 'this' | 'future',
    callerId: string,
  ): Promise<EventView[]> {
    const event = await loadManageableEvent(this.db, eventId, callerId);

    const changesTime = dto.starts_at !== undefined || dto.ends_at !== undefined;
    const acrossSeries = scope === 'future' && event.seriesId !== null;

    if (acrossSeries && changesTime) {
      throw new BadRequestException(
        'A start or end time can only be changed on a single practice. ' +
          'To retime a series, cancel it and create a new one.',
      );
    }

    const changes = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.location === undefined ? {} : { location: dto.location }),
      ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      ...(dto.starts_at === undefined ? {} : { startsAt: new Date(dto.starts_at) }),
      ...(dto.ends_at === undefined ? {} : { endsAt: new Date(dto.ends_at) }),
    };

    // scope=future on a one-off is a no-op rather than an error: there is no
    // series to walk, so the single row is the whole answer.
    const target =
      acrossSeries
        ? and(eq(events.seriesId, event.seriesId as string), gte(events.startsAt, event.startsAt))
        : eq(events.id, eventId);

    return this.db.update(events).set(changes).where(target).returning(EVENT_COLUMNS);
  }

  /** Calls a practice off.
   *
   * A status change, not a delete. An athlete needs to *learn* the practice is
   * off, and an event that vanishes from the calendar is indistinguishable from a
   * bug. It also keeps the participant rows and anything the next spec hangs off
   * them.
   *
   * Its own route rather than a `status` field on PATCH, so cancelling is one
   * auditable call and cannot happen as a side effect of renaming.
   *
   * Cancels **one** occurrence. Calling off the remainder of a series — a
   * semester ending early — is a real need and deliberately not built here: it
   * needs the same future-scope semantics as PATCH and there is no screen for it.
   */
  async cancelEvent(eventId: string, callerId: string): Promise<EventView> {
    await loadManageableEvent(this.db, eventId, callerId);

    const [canceled] = await this.db
      .update(events)
      .set({ status: 'canceled' })
      .where(eq(events.id, eventId))
      .returning(EVENT_COLUMNS);

    return canceled;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: PASS, 24 tests.

- [ ] **Step 5: Add the routes**

Add `Patch` to the `@nestjs/common` import in `events.controller.ts`, and `UpdateEventDto`, `UpdateScopeQueryDto` to the dto import:

```ts
  /** `?scope=this` (default) or `?scope=future`. `future` rejects time changes;
   * see the service comment. */
  @Patch(':eventId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Query() query: UpdateScopeQueryDto,
    @Body() dto: UpdateEventDto,
    @Req() req: RequestWithUser,
  ) {
    return this.eventsService.updateEvent(eventId, dto, query.scope ?? 'this', req.user.id);
  }

  @Post(':eventId/cancel')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async cancel(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.eventsService.cancelEvent(eventId, req.user.id);
  }
```

- [ ] **Step 6: Verify the gates and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
git add backend/src/teams
git commit -m "Edit and cancel practices, without collapsing a series"
```

---

### Task 10: Event participants

**Files:**
- Modify: `backend/src/teams/service/events.service.ts`
- Modify: `backend/src/teams/controller/events.controller.ts`
- Test: `backend/src/teams/service/events.service.spec.ts` (append)

**Interfaces:**
- Consumes: `loadManageableEvent`, `loadMembership` from `./team-access`; `AddParticipantDto` from `../dto/event.dto`.
- Produces: `EventsService.addParticipant(eventId: string, dto: AddParticipantDto, callerId: string): Promise<EventParticipantView>` and `EventsService.removeParticipant(eventId: string, userId: string, callerId: string): Promise<void>`.

- [ ] **Step 1: Append the failing tests**

Add to `backend/src/teams/service/events.service.spec.ts`:

```ts
describe('EventsService.addParticipant', () => {
  const participant = {
    user_id: ATHLETE_B,
    first_name: 'Ari',
    last_name: 'Cole',
    username: 'aric',
    avatar_url: null,
  };

  it('adds an athlete who is on the event team', async () => {
    const { service, harness } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'coach' }], [{ role: 'athlete' }]],
      event_participants: [[participant]],
    });

    const result = await service.addParticipant(EVENT, { user_id: ATHLETE_B }, COACH);

    expect(result).toEqual(participant);
    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toContain(
      'insert:event_participants',
    );
  });

  /** Participants are drawn from the team, so someone who is not on it cannot be
   * put in a practice. 404 rather than 403 — the caller supplied the id, and
   * confirming "real user, just not on your team" is the disclosure to avoid. */
  it('rejects someone who is not on the team', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'coach' }], []],
    });

    await expect(
      service.addParticipant(EVENT, { user_id: STRANGER }, COACH),
    ).rejects.toThrow(NotFoundException);
  });

  /** A coach is not a participant. They review the session; they did not lift at
   * it, and the video spec reads a participant row as "this person trained here". */
  it('rejects adding a coach of the team as a participant', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'coach' }], [{ role: 'coach' }]],
    });

    await expect(service.addParticipant(EVENT, { user_id: COACH }, COACH)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws 403 for an athlete member', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'athlete' }]],
    });

    await expect(
      service.addParticipant(EVENT, { user_id: ATHLETE_B }, ATHLETE_A),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('EventsService.removeParticipant', () => {
  it('deletes the participant row', async () => {
    const { service, harness } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'coach' }]],
    });

    await service.removeParticipant(EVENT, ATHLETE_A, COACH);

    expect(harness.writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      'delete:event_participants',
    ]);
  });

  it('throws 403 for an athlete member', async () => {
    const { service } = await build({
      events: [[eventRow]],
      team_members: [[{ role: 'athlete' }]],
    });

    await expect(service.removeParticipant(EVENT, ATHLETE_A, ATHLETE_A)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: FAIL — `service.addParticipant is not a function`.

- [ ] **Step 3: Implement the two methods**

Add `loadMembership` to the team-access import and `AddParticipantDto` to the dto import. Then add to `EventsService`:

```ts
  /** Puts one athlete into a practice they were not pre-filled into.
   *
   * Participants are drawn from the event's team, so this checks team membership
   * rather than the coach relationship — the coach already passed
   * `loadManageableEvent`, and anyone on the team was vetted when they joined it.
   *
   * A coach cannot be added: they review the session rather than lift at it, and
   * the video spec reads a participant row as "this person trained here".
   */
  async addParticipant(
    eventId: string,
    dto: AddParticipantDto,
    callerId: string,
  ): Promise<EventParticipantView> {
    const event = await loadManageableEvent(this.db, eventId, callerId);

    const role = await loadMembership(this.db, event.teamId, dto.user_id);

    if (!role) {
      // 404 rather than 403: the caller supplied this id, and confirming "a real
      // user, just not on your team" is the disclosure worth avoiding.
      throw new NotFoundException(`Team member with ID ${dto.user_id} could not be found`);
    }

    if (role !== 'athlete') {
      throw new BadRequestException('Only athletes can be participants in a practice');
    }

    await this.db.insert(eventParticipants).values({ eventId, userId: dto.user_id });

    const [participant] = await this.db
      .select({
        user_id: eventParticipants.userId,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
      })
      .from(eventParticipants)
      .innerJoin(users, eq(users.id, eventParticipants.userId))
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, dto.user_id)))
      .limit(1);

    return participant;
  }

  /** Takes one athlete out of a practice.
   *
   * A real delete, unlike event cancellation. Nobody needs to learn they were
   * removed from a session list the way they need to learn a practice is off, and
   * a tombstone row would just have to be filtered everywhere.
   */
  async removeParticipant(eventId: string, userId: string, callerId: string): Promise<void> {
    await loadManageableEvent(this.db, eventId, callerId);

    await this.db
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest src/teams/service/events.service.spec.ts
```

Expected: PASS, 30 tests.

- [ ] **Step 5: Add the routes**

Add `Delete` to the `@nestjs/common` import in `events.controller.ts` and `AddParticipantDto` to the dto import:

```ts
  @Post(':eventId/participants')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async addParticipant(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body() dto: AddParticipantDto,
    @Req() req: RequestWithUser,
  ) {
    return this.eventsService.addParticipant(eventId, dto, req.user.id);
  }

  @Delete(':eventId/participants/:userId')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async removeParticipant(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: RequestWithUser,
  ) {
    await this.eventsService.removeParticipant(eventId, userId, req.user.id);
  }
```

- [ ] **Step 6: Verify the gates and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
git add backend/src/teams
git commit -m "Adjust who is in a practice"
```

---

### Task 11: End-to-end tests against real Postgres

**Files:**
- Create: `backend/test/teams/teams.e2e-spec.ts`
- Modify: `backend/test/helpers/fixtures.ts` (the `sweepForUserIds` statement list)

**Interfaces:**
- Consumes: every endpoint from Tasks 5–10; `createTestUser`, `createAuthClient`, `dataDb`, `e2eProfileMarkers`, `requireLiveOptIn`, `cleanupUsers`, `type TestUser` from `../helpers/fixtures`.
- Produces: nothing other tasks depend on.

**Why this task is not optional even though the unit specs pass.** The mocked client in `db-mock.ts` ignores `where` and will happily accept SQL that Postgres rejects. The previous Drizzle port shipped two bugs invisible to mocked tests *by construction*: an `undefined` interpolated into a `where`, and a malformed uuid surfacing as a 500 instead of a 400. The unit specs prove the **rules**; this file proves the **queries execute** and the shapes are what the client expects.

- [ ] **Step 1: Register the new tables with the sweeper first**

⚠️ Do this before writing any spec. Rows from an unregistered table leak between runs, and `fixtures.ts:281` says so explicitly.

In `backend/test/helpers/fixtures.ts`, add to the `statements` array in `sweepForUserIds`, **before** the `coach_requests` entry (deepest first):

```ts
    [
      'event_participants',
      `delete from event_participants where user_id = any($1) or event_id in (
       select e.id from events e join teams t on t.id = e.team_id
       where t.created_by = any($1))`,
    ],
    [
      'events',
      `delete from events where created_by = any($1) or team_id in (
       select id from teams where created_by = any($1))`,
    ],
    [
      'team_members',
      `delete from team_members where user_id = any($1) or team_id in (
       select id from teams where created_by = any($1))`,
    ],
    ['teams', 'delete from teams where created_by = any($1)'],
```

The `team_id in (select ...)` clauses matter: a test coach adds a test athlete, and deleting only by `user_id` would leave the team and its events behind once both users are gone.

- [ ] **Step 2: Verify the sweeper still runs**

```bash
cd backend && E2E_ALLOW_LIVE=1 npm run e2e:sweep -- --all
```

Expected: exits 0. `[sweep] nothing to clean up` is a pass. A SQL error here means a typo in Step 1, and it is much cheaper to find now than after a failed suite.

- [ ] **Step 3: Write the e2e spec**

Create `backend/test/teams/teams.e2e-spec.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { useContainer } from 'class-validator';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import {
  cleanupUsers,
  createTestUser,
  dataDb,
  e2eProfileMarkers,
  requireLiveOptIn,
  type TestUser,
} from '../helpers/fixtures';

/** Teams and practice events against **real Postgres**.
 *
 * Run with: E2E_ALLOW_LIVE=1 npm run test:e2e -- teams
 *
 * ⚠️ Auth users come from the live Supabase project; all table rows go to the
 * Postgres named by DATABASE_URL.
 *
 * ⚠️ **A green `backend-e2e` job in CI does not mean this ran.** The job skips its
 * remaining steps with a workflow warning when SUPABASE_PROJECT_URL /
 * SUPABASE_SECRET_KEY are missing, or when the auth health probe gets no answer.
 * Look for the "E2E skipped" warning before trusting the check.
 */
describe('Teams and practice events (e2e)', () => {
  let app: INestApplication<Server>;
  let coachA: TestUser;
  let coachB: TestUser;
  let athlete: TestUser;
  let outsider: TestUser;
  let teamId: string;

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts. Without useContainer the DI-backed validators silently
    // resolve with no dependencies and every check passes.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    const markers = e2eProfileMarkers();
    coachA = await createTestUser({ ...markers, is_coach: true });
    coachB = await createTestUser({ ...markers, is_coach: true });
    athlete = await createTestUser({ ...markers, is_athlete: true });
    outsider = await createTestUser({ ...markers, is_athlete: true });

    // An active relationship is the precondition for adding the athlete to a
    // team. Inserted directly rather than driven through the invite endpoints —
    // those have their own e2e coverage and this suite is not testing them.
    await dataDb().query(
      `insert into coach_athlete_relationships (athlete_id, coach_id, status)
       values ($1, $2, 'active')`,
      [athlete.id, coachA.id],
    );
  }, 60_000);

  afterAll(async () => {
    await cleanupUsers(coachA.supabase, [coachA.id, coachB.id, athlete.id, outsider.id]);
    await app?.close();
  }, 60_000);

  const as = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });

  describe('POST /teams', () => {
    it('creates a team and makes the caller its coach', async () => {
      const response = await request(app.getHttpServer())
        .post('/teams')
        .set(as(coachA))
        .send({ name: 'E2E Powerlifting', timezone: 'America/New_York' })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'E2E Powerlifting',
        timezone: 'America/New_York',
        role: 'coach',
      });

      teamId = response.body.id as string;
    });

    it('rejects a caller with no coaches row', async () => {
      await request(app.getHttpServer())
        .post('/teams')
        .set(as(athlete))
        .send({ name: 'Nope', timezone: 'America/New_York' })
        .expect(403);
    });

    /** The fixed-offset alias check, proven through the real ValidationPipe rather
     * than only against the predicate. */
    it('rejects a fixed-offset timezone alias with a 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/teams')
        .set(as(coachA))
        .send({ name: 'Nope', timezone: 'EST' })
        .expect(400);

      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/teams')
        .send({ name: 'Nope', timezone: 'UTC' })
        .expect(401);
    });
  });

  describe('GET /teams/:teamId', () => {
    it('returns 404 for a non-member rather than 403', async () => {
      await request(app.getHttpServer()).get(`/teams/${teamId}`).set(as(outsider)).expect(404);
    });

    /** A malformed uuid must be a 400 from ParseUUIDPipe, not a 500 from Postgres
     * failing to cast it. This exact failure shipped once already. */
    it('returns 400 for a malformed team id', async () => {
      await request(app.getHttpServer()).get('/teams/not-a-uuid').set(as(coachA)).expect(400);
    });
  });

  describe('POST /teams/:teamId/members', () => {
    it('adds an athlete the caller actively coaches', async () => {
      const response = await request(app.getHttpServer())
        .post(`/teams/${teamId}/members`)
        .set(as(coachA))
        .send({ user_id: athlete.id, role: 'athlete' })
        .expect(201);

      expect(response.body).toMatchObject({ user_id: athlete.id, role: 'athlete' });
    });

    it('rejects an athlete the caller does not coach, with a 404', async () => {
      await request(app.getHttpServer())
        .post(`/teams/${teamId}/members`)
        .set(as(coachA))
        .send({ user_id: outsider.id, role: 'athlete' })
        .expect(404);
    });

    /** The unique index on (team_id, user_id) is what makes this a clean failure
     * rather than a duplicate row. Proves the index exists and is applied. */
    it('rejects a duplicate membership', async () => {
      await request(app.getHttpServer())
        .post(`/teams/${teamId}/members`)
        .set(as(coachA))
        .send({ user_id: athlete.id, role: 'athlete' })
        .expect((res) => {
          expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    it('lets the team athlete read the team and see the roster', async () => {
      const response = await request(app.getHttpServer())
        .get(`/teams/${teamId}`)
        .set(as(athlete))
        .expect(200);

      expect(response.body.role).toBe('athlete');
      expect(response.body.members.map((m: { user_id: string }) => m.user_id).sort()).toEqual(
        [coachA.id, athlete.id].sort(),
      );
    });

    it('throws 403 when the team athlete tries to add a member', async () => {
      await request(app.getHttpServer())
        .post(`/teams/${teamId}/members`)
        .set(as(athlete))
        .send({ user_id: outsider.id, role: 'athlete' })
        .expect(403);
    });
  });

  describe('POST /events', () => {
    let seriesIds: string[];

    /** ⚠️ **The DST guarantee, end to end.** Two Wednesdays either side of the
     * 2026-11-01 transition must both be 17:00 America/New_York — which means the
     * stored instants differ by 8 days' worth of hours, not 7. This is the one
     * assertion that proves the whole timezone design works through Postgres's
     * timestamptz round-trip, not just in the pure function. */
    it('expands a series and keeps the local time across DST', async () => {
      const response = await request(app.getHttpServer())
        .post('/events')
        .set(as(coachA))
        .send({
          team_id: teamId,
          title: 'E2E Wednesday practice',
          recurrence: {
            weekdays: [3],
            start_time: '17:00',
            duration_minutes: 90,
            start_date: '2026-10-28',
            end_date: '2026-11-04',
          },
        })
        .expect(201);

      expect(response.body).toHaveLength(2);

      const starts = (response.body as Array<{ starts_at: string }>).map((e) =>
        new Date(e.starts_at).toISOString(),
      );
      expect(starts).toEqual(['2026-10-28T21:00:00.000Z', '2026-11-04T22:00:00.000Z']);

      const series = new Set((response.body as Array<{ series_id: string }>).map((e) => e.series_id));
      expect(series.size).toBe(1);

      seriesIds = (response.body as Array<{ id: string }>).map((e) => e.id);
    });

    it('pre-fills the team athlete as a participant of each occurrence', async () => {
      const response = await request(app.getHttpServer())
        .get(`/events/${seriesIds[0]}`)
        .set(as(coachA))
        .expect(200);

      expect(response.body.participants.map((p: { user_id: string }) => p.user_id)).toEqual([
        athlete.id,
      ]);
    });

    it('lets the team athlete read the calendar', async () => {
      const response = await request(app.getHttpServer())
        .get('/events')
        .query({ team_id: teamId, from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' })
        .set(as(athlete))
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns 400 when the window is missing', async () => {
      await request(app.getHttpServer())
        .get('/events')
        .query({ team_id: teamId })
        .set(as(coachA))
        .expect(400);
    });

    it('returns 404 to an outsider asking for the calendar', async () => {
      await request(app.getHttpServer())
        .get('/events')
        .query({ team_id: teamId, from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' })
        .set(as(outsider))
        .expect(404);
    });

    it('rejects a series longer than 52 weeks with a 400', async () => {
      await request(app.getHttpServer())
        .post('/events')
        .set(as(coachA))
        .send({
          team_id: teamId,
          title: 'Forever',
          recurrence: {
            weekdays: [3],
            start_time: '17:00',
            duration_minutes: 90,
            start_date: '2026-01-01',
            end_date: '2027-06-01',
          },
        })
        .expect(400);
    });

    describe('editing', () => {
      it('renames the rest of the series under scope=future', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/events/${seriesIds[0]}`)
          .query({ scope: 'future' })
          .set(as(coachA))
          .send({ title: 'E2E Renamed practice' })
          .expect(200);

        expect(response.body).toHaveLength(2);
      });

      it('refuses a time change across a series with a 400', async () => {
        await request(app.getHttpServer())
          .patch(`/events/${seriesIds[0]}`)
          .query({ scope: 'future' })
          .set(as(coachA))
          .send({ starts_at: '2026-10-28T22:00:00.000Z' })
          .expect(400);
      });

      /** Any coach of the team may edit, including one who did not create the
       * event — the opposite of the workout rule, deliberately. */
      it('lets a second coach of the team edit an event they did not create', async () => {
        await request(app.getHttpServer())
          .post(`/teams/${teamId}/members`)
          .set(as(coachA))
          .send({ user_id: coachB.id, role: 'coach' })
          .expect(201);

        await request(app.getHttpServer())
          .patch(`/events/${seriesIds[1]}`)
          .set(as(coachB))
          .send({ location: 'The annex' })
          .expect(200);
      });

      it('throws 403 when the team athlete tries to edit', async () => {
        await request(app.getHttpServer())
          .patch(`/events/${seriesIds[0]}`)
          .set(as(athlete))
          .send({ title: 'Mine now' })
          .expect(403);
      });

      it('returns 404 to an outsider, not 403', async () => {
        await request(app.getHttpServer())
          .patch(`/events/${seriesIds[0]}`)
          .set(as(outsider))
          .send({ title: 'Mine now' })
          .expect(404);
      });
    });

    describe('cancelling', () => {
      it('marks the event canceled and keeps it on the calendar', async () => {
        const cancelled = await request(app.getHttpServer())
          .post(`/events/${seriesIds[0]}/cancel`)
          .set(as(coachA))
          .expect(200);

        expect(cancelled.body.status).toBe('canceled');

        const calendar = await request(app.getHttpServer())
          .get('/events')
          .query({
            team_id: teamId,
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-12-01T00:00:00.000Z',
          })
          .set(as(athlete))
          .expect(200);

        // Still two rows. A canceled practice the athlete cannot see is
        // indistinguishable from a bug.
        expect(calendar.body).toHaveLength(2);
        expect(
          (calendar.body as Array<{ id: string; status: string }>).find(
            (e) => e.id === seriesIds[0],
          )?.status,
        ).toBe('canceled');
      });
    });

    describe('participants', () => {
      it('removes and re-adds an athlete', async () => {
        await request(app.getHttpServer())
          .delete(`/events/${seriesIds[1]}/participants/${athlete.id}`)
          .set(as(coachA))
          .expect(204);

        await request(app.getHttpServer())
          .post(`/events/${seriesIds[1]}/participants`)
          .set(as(coachA))
          .send({ user_id: athlete.id })
          .expect(201);
      });

      it('rejects someone who is not on the team', async () => {
        await request(app.getHttpServer())
          .post(`/events/${seriesIds[1]}/participants`)
          .set(as(coachA))
          .send({ user_id: outsider.id })
          .expect(404);
      });
    });
  });

  describe('DELETE /teams/:teamId/members/:userId', () => {
    it('refuses to remove the last coach', async () => {
      // coachB was added above, so remove them first to get back to one coach.
      await request(app.getHttpServer())
        .delete(`/teams/${teamId}/members/${coachB.id}`)
        .set(as(coachA))
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/teams/${teamId}/members/${coachA.id}`)
        .set(as(coachA))
        .expect(409);
    });

    /** ⚠️ Participant rows outlive membership. A cascade here would delete a
     * departed athlete's training history — and, once the video spec lands, their
     * submitted videos. */
    it('removes the athlete but leaves their participant rows', async () => {
      await request(app.getHttpServer())
        .delete(`/teams/${teamId}/members/${athlete.id}`)
        .set(as(coachA))
        .expect(204);

      const { rows } = await dataDb().query(
        'select count(*)::int as count from event_participants where user_id = $1',
        [athlete.id],
      );
      expect(rows[0].count).toBeGreaterThan(0);
    });
  });
});
```

⚠️ These tests share state in declaration order — `teamId` and `seriesIds` are set by earlier tests. That matches the existing `programming.e2e-spec.ts` style and keeps the fixture count down, but it means **the file must not be run with `--randomize`**.

- [ ] **Step 4: Run the e2e suite**

```bash
cd backend && npm run db:up && npm run db:migrate && npm run db:seed
E2E_ALLOW_LIVE=1 npm run test:e2e -- teams
```

Expected: PASS. If it fails at `SupabaseService` construction, `SUPABASE_PROJECT_URL` / `SUPABASE_SECRET_KEY` are missing from `backend/.env` — that is a setup problem, not a code problem. See `docs/SETUP.md`.

- [ ] **Step 5: Confirm nothing leaked**

```bash
cd backend && E2E_ALLOW_LIVE=1 npm run e2e:sweep -- --all
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/test
git commit -m "Prove the team calendar works against real Postgres"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/AUTHORIZATION.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md`
- Modify: `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: the finished behavior of Tasks 1–11.
- Produces: nothing code depends on.

In this repo the docs are load-bearing — `docs/AUTHORIZATION.md` is cited by `CLAUDE.md` as the place the ownership rules live, with the code and test for each. A rule that only exists in code is a rule the next person will not know is deliberate.

- [ ] **Step 1: Add the authorization matrix section**

In `docs/AUTHORIZATION.md`, under `## The matrix`, after the `### workouts / sets / exercises` section, add a `### teams / events` section in the same format the existing sections use (endpoint, who may reach it, the enforcing function, the test that pins it). It must state:

- Read a team, its roster, its events — any member, coach or athlete. Enforced by `assertReadableTeam` / `loadReadableEvent` in `backend/src/teams/service/team-access.ts`, pinned by `team-access.spec.ts`.
- Change a team, its membership, or any of its events — any **coach** of the team, **including one who did not create the event**. Enforced by `assertManageableTeam` / `loadManageableEvent`, pinned by `team-access.spec.ts` and by the e2e case "lets a second coach of the team edit an event they did not create".
- Add an athlete to a team — only a coach in an **active** relationship with them, via `isActiveCoachOf` reused from `programming-access.ts`. Pinned by the `addMember` specs.
- Athletes see the full team roster and per-event participant lists. This is a deliberate disclosure; note that it covers team membership only and never another athlete's programming or maxes.
- Reading an event does **not** require being its participant.

- [ ] **Step 2: Extend the 403-versus-404 section**

In the `## Where 403 is used instead of 404, and why` section, add the two new cases:

- A team member who is not a coach, attempting any write — 403, because they can already read the team so it discloses nothing and is the more useful answer.
- Everything else with no claim — 404, including the case where the event exists but the caller is a stranger to its team. Note that `loadEventForMember` throws the **same exception instance** for "no such event" and "not your team", so the two are indistinguishable from outside.

- [ ] **Step 3: Update roadmap open question 3**

In `docs/ROADMAP.md`, open question 3 (*"What is a `team`?"*) is now partly answered. Rewrite it as answered-in-part, dated 2026-09-22:

- **Answered:** a team is a roster grouping with a practice calendar. It grants calendar scope and roster visibility, and nothing else.
- **Explicitly declined:** the leaderboard-scope reading (open question 4 already records that cross-athlete comparable lifts need a canonical movement catalogue nobody has designed) and the federation-affiliation reading.
- **Still open:** whether a team ever becomes the unit that grants programming access. Today it does not, and `coach_athlete_relationships` remains the only thing that does.

Also update the §3.5 row that reads `` `teams` is dead `` — it is not any more.

⚠️ Do **not** silently restate the cutline. `docs/ROADMAP.md` puts team work *below* it and this feature was promoted above it by an explicit decision; say so, and note that item 3 (bulk assign) is still the adoption decider.

- [ ] **Step 4: Update the two CLAUDE.md files**

In the root `CLAUDE.md`, in the "data path" section, the client-calls-the-API bullet says "All nine `frontend/lib/api/*` modules" and lists them. Update to **eleven**, adding `events` and `teams` in alphabetical order.

In `frontend/CLAUDE.md`, the "Talking to the backend" section carries the same sentence and the same list. Update it identically. Both counts have already been updated once for `maxes`, so this is a known-stale pair.

- [ ] **Step 5: Verify the counts are actually right**

```bash
cd frontend && ls lib/api/*.ts | wc -l && ls lib/api
```

Expected: the module count you wrote matches, remembering `client.ts` and `polling.ts` are not resource modules. Count only the resource modules the sentence enumerates.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md frontend/CLAUDE.md
git commit -m "Record who may reach a team calendar, and what a team now is"
```

---

### Task 13: Frontend types and API modules

**Files:**
- Create: `frontend/types/team.ts`
- Create: `frontend/types/event.ts`
- Create: `frontend/lib/api/teams.ts`
- Create: `frontend/lib/api/events.ts`
- Modify: `frontend/types/index.ts`

**Interfaces:**
- Consumes: the response shapes produced by Tasks 5–10; `api` from `@/lib/api/client`.
- Produces:
  - `types/team.ts`: `TeamRole`, `Team`, `TeamMember`, `TeamDetail`
  - `types/event.ts`: `EventStatus`, `PracticeEvent`, `EventParticipant`, `EventDetail`, `RecurrenceInput`
  - `lib/api/teams.ts`: `fetchTeams`, `fetchTeam`, `createTeam`, `updateTeam`, `addTeamMember`, `removeTeamMember`
  - `lib/api/events.ts`: `fetchEvents`, `fetchEvent`, `createEvent`, `updateEvent`, `cancelEvent`, `addParticipant`, `removeParticipant`

⚠️ **Frontend conventions differ from the backend.** Double quotes, `@/...` imports exclusively, TS `strict` **on** (so no implicit `any`), no Prettier. Getting this wrong is silent until CI.

Dates cross the wire as ISO **strings**, not `Date` objects — JSON has no date type. The backend types say `Date`; these say `string`. That mismatch is deliberate and the boundary is `JSON.parse`.

- [ ] **Step 1: Write the types**

Create `frontend/types/team.ts`:

```ts
/** A team: a named group of athletes and coaches, and the scope a practice
 * calendar belongs to.
 *
 * A team grants **nothing** beyond calendar scope and roster visibility.
 * Programming and maxes are still governed by the coach↔athlete relationship,
 * so being on someone's team does not mean you can see their training.
 */
export type TeamRole = "coach" | "athlete";

export interface Team {
  id: string;
  name: string;
  /** IANA identifier, e.g. "America/New_York". Fixed-offset aliases like "EST"
   * are rejected by the API because they do not observe DST. */
  timezone: string;
  created_at: string;
  /** The *caller's* role on this team, folded in by the API so the client does
   * not have to find itself in the member list. */
  role: TeamRole;
}

export interface TeamMember {
  user_id: string;
  role: TeamRole;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface TeamDetail extends Team {
  members: TeamMember[];
}
```

Create `frontend/types/event.ts`:

```ts
/** A practice event: one training session, and the anchor everything tied to that
 * session hangs off. */
export type EventStatus = "scheduled" | "canceled";

export interface PracticeEvent {
  id: string;
  team_id: string;
  /** Shared by every occurrence of a recurring series; null for a one-off. */
  series_id: string | null;
  title: string;
  /** ISO 8601 instant. Render in the device's zone — for a co-located team that
   * is the team's zone. Do not re-interpret it against team.timezone. */
  starts_at: string;
  ends_at: string;
  location: string | null;
  notes: string | null;
  /** A canceled practice stays on the calendar, marked. It is never removed —
   * an event that vanishes is indistinguishable from a bug. */
  status: EventStatus;
  created_by: string;
}

export interface EventParticipant {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface EventDetail extends PracticeEvent {
  participants: EventParticipant[];
}

/** A recurrence rule, in the team's local wall-clock terms rather than instants.
 * The API resolves each occurrence against the team's timezone. */
export interface RecurrenceInput {
  /** 0 = Sunday .. 6 = Saturday. */
  weekdays: number[];
  /** "HH:MM". */
  start_time: string;
  duration_minutes: number;
  /** "YYYY-MM-DD", inclusive. An end date is required — the API materializes
   * every occurrence, so there is no such thing as an open-ended series. */
  start_date: string;
  end_date: string;
}
```

Then add to `frontend/types/index.ts`, keeping the list alphabetical:

```ts
export * from "./event";
export * from "./team";
```

- [ ] **Step 2: Write the teams API module**

Create `frontend/lib/api/teams.ts`:

```ts
import { api } from "@/lib/api/client";
import type { Team, TeamDetail, TeamMember, TeamRole } from "@/types";

/** Teams — the roster grouping a practice calendar belongs to.
 *
 * A team grants calendar scope and roster visibility and nothing else; coach
 * access to programming still comes from the coach↔athlete relationship.
 *
 * There is no delete. A team with events and participant rows has no cascade
 * story yet, and leaving the gap visible beats half-building it.
 */

export async function fetchTeams() {
  return api.get<Team[]>("/teams");
}

export async function fetchTeam(teamId: string) {
  return api.get<TeamDetail>(`/teams/${teamId}`);
}

/** Creates a team with the caller as its first coach. Athletes get a 403 — only
 * a user with a coach profile may create one. */
export async function createTeam(name: string, timezone: string) {
  return api.post<Team>("/teams", { name, timezone });
}

export async function updateTeam(
  teamId: string,
  changes: { name?: string; timezone?: string },
) {
  return api.patch<Team>(`/teams/${teamId}`, changes);
}

/** Adds someone to a team.
 *
 * There is no invite-and-accept step: an athlete can only be added by a coach who
 * already has an active relationship with them, so consent happened when they
 * accepted that coach. Adding an athlete you do not coach returns a 404.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole,
) {
  return api.post<TeamMember>(`/teams/${teamId}/members`, {
    user_id: userId,
    role,
  });
}

/** Removes a member. The API refuses with a 409 if they are the last coach —
 * a team with no coach can never be managed again. */
export async function removeTeamMember(teamId: string, userId: string) {
  return api.delete<void>(`/teams/${teamId}/members/${userId}`);
}
```

- [ ] **Step 3: Write the events API module**

Create `frontend/lib/api/events.ts`:

```ts
import { api } from "@/lib/api/client";
import type {
  EventDetail,
  EventParticipant,
  PracticeEvent,
  RecurrenceInput,
} from "@/types";

/** Practice events — the shared anchor for a training session.
 *
 * Reading needs team membership. Writing needs to be a **coach** of the team —
 * any coach of it, not only whoever created the event. That is the opposite of
 * the workout rule and is deliberate: a shared calendar only its author can fix
 * is worse than the Google Calendar it replaces.
 */

/** The team's calendar for a window. The window is **required**: the API rejects
 * an unbounded read, so always pass a range the screen actually shows. */
export async function fetchEvents(teamId: string, from: string, to: string) {
  const query = new URLSearchParams({ team_id: teamId, from, to });
  return api.get<PracticeEvent[]>(`/events?${query.toString()}`);
}

export async function fetchEvent(eventId: string) {
  return api.get<EventDetail>(`/events/${eventId}`);
}

/** Creates one practice, or a whole series.
 *
 * Always returns an **array**, even for a one-off — a response shape that
 * depended on the request shape would be a trap for every caller.
 *
 * Every current team athlete is added as a participant automatically.
 */
export async function createEvent(input: {
  team_id: string;
  title: string;
  location?: string;
  notes?: string;
  starts_at?: string;
  ends_at?: string;
  recurrence?: RecurrenceInput;
}) {
  return api.post<PracticeEvent[]>("/events", input);
}

/** Edits a practice, or the rest of its series.
 *
 * ⚠️ `scope: "future"` **rejects time changes with a 400**, on purpose: those
 * columns hold absolute instants, so one value written across every remaining
 * occurrence would stack a whole semester onto one evening. Move a single
 * practice with `scope: "this"`; to retime a series, cancel it and create a new
 * one.
 */
export async function updateEvent(
  eventId: string,
  changes: {
    title?: string;
    location?: string;
    notes?: string;
    starts_at?: string;
    ends_at?: string;
  },
  scope: "this" | "future" = "this",
) {
  return api.patch<PracticeEvent[]>(`/events/${eventId}?scope=${scope}`, changes);
}

/** Calls a practice off. A status change, not a delete — the event stays on the
 * calendar marked canceled so athletes learn it is off. */
export async function cancelEvent(eventId: string) {
  return api.post<PracticeEvent>(`/events/${eventId}/cancel`);
}

export async function addParticipant(eventId: string, userId: string) {
  return api.post<EventParticipant>(`/events/${eventId}/participants`, {
    user_id: userId,
  });
}

export async function removeParticipant(eventId: string, userId: string) {
  return api.delete<void>(`/events/${eventId}/participants/${userId}`);
}
```

- [ ] **Step 4: Verify the gates**

```bash
cd frontend && npm run type-check && npm run lint
```

Expected: both clean. `strict` is on here, so an implicit `any` fails the type-check — unlike the backend.

- [ ] **Step 5: Commit**

```bash
git add frontend/types frontend/lib/api
git commit -m "Add the client layer for teams and practice events"
```

---

### Task 14: The calendar tab

**Files:**
- Create: `frontend/app/(app)/(tabs)/calendar.tsx`
- Modify: `frontend/app/(app)/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `fetchTeams` from `@/lib/api/teams`, `fetchEvents` from `@/lib/api/events` (Task 13); `Screen`, `Section`, `Text`, `EmptyState`, `Button` from `@/components/ui`.
- Produces: the `/calendar` route. Tasks 15 and 16 navigate to it and back.

⚠️ **Screens import from `@/components/ui` and never write raw color classes.** The light/dark pairing lives inside those primitives, and that is what keeps the two themes from drifting the way they already did once.

- [ ] **Step 1: Add the tab**

In `frontend/app/(app)/(tabs)/_layout.tsx`, add `CalendarDays` to the `lucide-react-native` import and insert this screen between the Messages tab and the `<Tabs.Protected>` block for Program:

```tsx
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} strokeWidth={2} />
          ),
        }}
      />
```

**Ungated on purpose** — both roles get it, which keeps each role at five tabs rather than six. Do not wrap it in `<Tabs.Protected>`.

Do not add `screenOptions` to it; the navigator sets them, and the comment in that file explains why.

- [ ] **Step 2: Write the screen**

Create `frontend/app/(app)/(tabs)/calendar.tsx`:

```tsx
import { Button, EmptyState, Screen, Section, Text } from "@/components/ui";
import { fetchEvents } from "@/lib/api/events";
import { fetchTeams } from "@/lib/api/teams";
import { useTheme } from "@/theme/useTheme";
import type { PracticeEvent, Team } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, startOfToday, subMonths } from "date-fns";
import { router } from "expo-router";
import { CalendarDays, ChevronRight, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";

/** The window the calendar asks for. The API requires one — an unbounded read of
 * a team's whole history is not a screen anyone is building. A month back and
 * three forward covers "what did we do last week" and a full training block. */
function windowAround(now: Date) {
  return {
    from: subMonths(now, 1).toISOString(),
    to: addMonths(now, 3).toISOString(),
  };
}

function EventRow({ event }: { event: PracticeEvent }) {
  const { colors } = useTheme();
  const canceled = event.status === "canceled";
  const start = new Date(event.starts_at);

  return (
    <Pressable
      onPress={() => router.push(`/events/${event.id}`)}
      className="flex-row items-center gap-3 border-b border-hairline dark:border-hairline-dark py-3"
    >
      <View className="w-14 items-center">
        <Text variant="overline" tone="muted">
          {format(start, "EEE")}
        </Text>
        <Text variant="title" tone={canceled ? "muted" : "ink"}>
          {format(start, "d")}
        </Text>
      </View>

      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" tone={canceled ? "muted" : "ink"}>
          {event.title}
        </Text>
        <Text variant="caption" tone="muted">
          {/* Rendered in the device's zone, which for a co-located team is the
              team's zone. Do not re-interpret against team.timezone. */}
          {format(start, "h:mm a")}
          {event.location ? ` · ${event.location}` : ""}
        </Text>
        {canceled ? (
          <Text variant="caption" tone="error">
            Canceled
          </Text>
        ) : null}
      </View>

      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  );
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams });

  const teams: Team[] = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];

  const window = useMemo(() => windowAround(startOfToday()), []);

  const eventsQuery = useQuery({
    queryKey: ["events", activeTeam?.id, window.from, window.to],
    queryFn: () => fetchEvents(activeTeam!.id, window.from, window.to),
    enabled: Boolean(activeTeam),
  });

  if (teamsQuery.isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (teams.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={CalendarDays}
          title="No team yet"
          body="Practices show up here once you're on a team. A coach adds you from their roster."
        />
      </Screen>
    );
  }

  const isCoach = activeTeam?.role === "coach";

  return (
    <Screen>
      <View className="flex-row items-center justify-between pb-2">
        <Text variant="title">{activeTeam?.name}</Text>
        {isCoach ? (
          <Pressable
            onPress={() => router.push(`/events/new?teamId=${activeTeam.id}`)}
            hitSlop={8}
          >
            <Plus size={22} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Only shown when there is a choice to make. One team is the common case
          and a picker over a single option is noise. */}
      {teams.length > 1 ? (
        <Section label="Team">
          <View className="flex-row flex-wrap gap-2">
            {teams.map((team) => (
              <Button
                key={team.id}
                label={team.name}
                variant={team.id === activeTeam?.id ? "primary" : "secondary"}
                onPress={() => setSelectedTeamId(team.id)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      <FlatList
        data={eventsQuery.data ?? []}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => <EventRow event={item} />}
        refreshing={eventsQuery.isRefetching}
        onRefresh={() => void eventsQuery.refetch()}
        ListEmptyComponent={
          eventsQuery.isLoading ? null : (
            <EmptyState
              icon={CalendarDays}
              title="No practices scheduled"
              body={
                isCoach
                  ? "Add a practice and your athletes will see it here."
                  : "Your coach hasn't scheduled anything in this window yet."
              }
              actionLabel={isCoach ? "Add a practice" : undefined}
              onAction={
                isCoach
                  ? () => router.push(`/events/new?teamId=${activeTeam.id}`)
                  : undefined
              }
            />
          )
        }
      />
    </Screen>
  );
}
```

There is **no polling here**. `lib/api/polling.ts` exists for messages, where five seconds matters; a practice calendar changes a few times a semester. Pull-to-refresh plus TanStack Query's refetch-on-focus is the right amount.

- [ ] **Step 3: Verify the classes actually exist**

⚠️ Neither `lint` nor `type-check` can see a class that generates no CSS — that is exactly how light mode stayed unimplemented for months.

```bash
cd frontend && npx tailwindcss -i ./global.css -o /tmp/calendar-out.css --config ./tailwind.config.js
```

Then check every `className` token in the new file against `/tmp/calendar-out.css`. The tokens introduced here are `border-hairline`, `dark:border-hairline-dark`, `w-14` and `gap-0.5`, plus layout utilities already used elsewhere. Icon colors come from `useTheme()` rather than a class or a hex literal — `theme/useTheme.ts` exists for exactly the props that take a real color value. Any token with no match is a dead class — fix it rather than shipping it.

⚠️ This check runs the **web** compiler and has one blind spot: `vh`/`vw` units compile fine and are silently ignored on device. Nothing here uses them; keep it that way.

- [ ] **Step 4: Run the gates**

```bash
cd frontend && npm run type-check && npm run lint
```

Expected: both clean.

- [ ] **Step 5: See it run**

```bash
cd frontend && npx expo start
```

With the backend running (`cd backend && npm run start:dev`), open the app and confirm: the Calendar tab appears for both an athlete and a coach account, the empty state reads correctly with no team, and **the screen renders correctly in both light and dark mode**. Toggle the device appearance and look at it — this is the check CI cannot do for you.

- [ ] **Step 6: Commit**

```bash
git add frontend/app
git commit -m "Show the team practice calendar"
```

---

### Task 15: Event detail and create screens

**Files:**
- Create: `frontend/app/(app)/events/[eventId].tsx`
- Create: `frontend/app/(app)/events/new.tsx`

**Interfaces:**
- Consumes: `fetchEvent`, `cancelEvent`, `createEvent`, `removeParticipant` from `@/lib/api/events`; `fetchTeam` from `@/lib/api/teams`.
- Produces: the `/events/[eventId]` and `/events/new` routes, both pushed from Task 14.

These live under `(app)/` rather than `(tabs)/` — a stack screen pushed over the tab bar, matching how `roster/[athleteId]`, `workout/[workoutId]` and `maxes/[athleteId]` are laid out.

- [ ] **Step 1: Write the detail screen**

Create `frontend/app/(app)/events/[eventId].tsx`:

```tsx
import { Avatar, Button, Screen, Section, Text } from "@/components/ui";
import { cancelEvent, fetchEvent } from "@/lib/api/events";
import { describeApiError } from "@/lib/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const queryClient = useQueryClient();

  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => fetchEvent(eventId),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelEvent(eventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error: unknown) =>
      Alert.alert("Could not cancel", describeApiError(error)),
  });

  const event = eventQuery.data;

  if (eventQuery.isLoading || !event) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const canceled = event.status === "canceled";

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-5 pb-8">
        <View className="gap-1">
          <Text variant="title">{event.title}</Text>
          <Text variant="body" tone="muted">
            {format(start, "EEEE d MMMM")} · {format(start, "h:mm a")} –{" "}
            {format(end, "h:mm a")}
          </Text>
          {event.location ? (
            <Text variant="body" tone="muted">
              {event.location}
            </Text>
          ) : null}
          {canceled ? (
            <Text variant="bodyStrong" tone="error">
              This practice is canceled
            </Text>
          ) : null}
        </View>

        {event.notes ? (
          <Section label="Notes">
            <Text variant="body">{event.notes}</Text>
          </Section>
        ) : null}

        <Section label={`Athletes (${event.participants.length})`}>
          {event.participants.length === 0 ? (
            <Text variant="body" tone="muted">
              Nobody is in this practice yet.
            </Text>
          ) : (
            event.participants.map((participant) => (
              <View
                key={participant.user_id}
                className="flex-row items-center gap-3 py-2"
              >
                <Avatar uri={participant.avatar_url} size={36} />
                <Text variant="body">
                  {participant.first_name} {participant.last_name}
                </Text>
              </View>
            ))
          )}
        </Section>

        {/* Shown to coaches only. The API enforces this too — the button's
            absence is convenience, not security. */}
        {!canceled ? (
          <Button
            label="Cancel this practice"
            variant="danger"
            block
            loading={cancelMutation.isPending}
            onPress={() =>
              Alert.alert(
                "Cancel this practice?",
                "It stays on the calendar marked canceled, so your athletes can see it's off.",
                [
                  { text: "Keep it", style: "cancel" },
                  {
                    text: "Cancel practice",
                    style: "destructive",
                    onPress: () => cancelMutation.mutate(),
                  },
                ],
              )
            }
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
```

Prop shapes verified against the primitives as of 2026-09-22: `Avatar` takes `{ uri?: string | null; size?: number; className?: string }` — there is **no** `name` prop and `size` is a number, not a token. `ButtonVariant` is `"primary" | "secondary" | "ghost" | "danger"`, so `danger` is real. Do not add a variant to a primitive for one screen.

- [ ] **Step 2: Write the create screen**

Create `frontend/app/(app)/events/new.tsx`:

```tsx
import { Button, Chip, Field, Input, Screen, Section, Text } from "@/components/ui";
import { describeApiError } from "@/lib/api/client";
import { createEvent } from "@/lib/api/events";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export default function NewEventScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [repeats, setRepeats] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState(new Date());
  const [durationMinutes, setDurationMinutes] = useState("90");
  const [endDate, setEndDate] = useState(new Date());

  const createMutation = useMutation({
    mutationFn: () => {
      const duration = Number(durationMinutes);

      if (repeats) {
        return createEvent({
          team_id: teamId,
          title,
          location: location || undefined,
          recurrence: {
            weekdays,
            start_time: format(startsAt, "HH:mm"),
            duration_minutes: duration,
            start_date: format(startsAt, "yyyy-MM-dd"),
            end_date: format(endDate, "yyyy-MM-dd"),
          },
        });
      }

      return createEvent({
        team_id: teamId,
        title,
        location: location || undefined,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      router.back();
    },
    onError: (error: unknown) =>
      Alert.alert("Could not create", describeApiError(error)),
  });

  const canSubmit =
    title.trim().length > 0 &&
    Number(durationMinutes) > 0 &&
    (!repeats || weekdays.length > 0);

  return (
    <Screen dismissKeyboard>
      <ScrollView contentContainerClassName="gap-5 pb-8">
        <Text variant="title">New practice</Text>

        <Field label="Title">
          <Input
            value={title}
            onChangeText={setTitle}
            placeholder="Wednesday practice"
          />
        </Field>

        <Field label="Location">
          <Input
            value={location}
            onChangeText={setLocation}
            placeholder="Marino Center"
          />
        </Field>

        <Field label="Starts">
          <DateTimePicker
            value={startsAt}
            mode="datetime"
            onChange={(_event, date) => date && setStartsAt(date)}
          />
        </Field>

        <Field label="Length (minutes)">
          <Input
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            keyboardType="number-pad"
          />
        </Field>

        <Section label="Repeat">
          <View className="flex-row gap-2">
            <Chip
              label="Just once"
              selected={!repeats}
              onPress={() => setRepeats(false)}
            />
            <Chip
              label="Weekly"
              selected={repeats}
              onPress={() => setRepeats(true)}
            />
          </View>
        </Section>

        {repeats ? (
          <>
            <Section label="Days">
              <View className="flex-row flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day.value}
                    label={day.label}
                    selected={weekdays.includes(day.value)}
                    onPress={() =>
                      setWeekdays((current) =>
                        current.includes(day.value)
                          ? current.filter((d) => d !== day.value)
                          : [...current, day.value],
                      )
                    }
                  />
                ))}
              </View>
            </Section>

            {/* Required, not optional. Every occurrence is a real row, so a
                series has to end somewhere — normally the last week of the
                training block. The API rejects an open-ended series. */}
            <Field label="Repeat until">
              <DateTimePicker
                value={endDate}
                mode="date"
                onChange={(_event, date) => date && setEndDate(date)}
              />
            </Field>
          </>
        ) : null}

        <Button
          label={repeats ? "Create series" : "Create practice"}
          block
          disabled={!canSubmit}
          loading={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        />
      </ScrollView>
    </Screen>
  );
}
```

`Field` is `{ label, children, hint?, error?, optional?, className? }` and `Input` extends `TextInputProps`, so `value` / `onChangeText` / `placeholder` / `keyboardType` pass straight through — both verified 2026-09-22.

⚠️ `DateTimePicker`'s `mode="datetime"` is **iOS-only**. On Android it silently behaves as date-only, so the time never gets set and every practice lands at midnight. If you develop against Android, render separate `mode="date"` and `mode="time"` pickers and combine them.

- [ ] **Step 3: Verify classes, then the gates**

```bash
cd frontend && npx tailwindcss -i ./global.css -o /tmp/events-out.css --config ./tailwind.config.js
npm run type-check && npm run lint
```

Check every `className` token in both new files against the compiled CSS. Expected: type-check and lint clean, zero dead classes.

- [ ] **Step 4: Exercise both screens end to end**

With the backend running, as a coach: create a weekly series across at least two weeks, open one occurrence, confirm the athlete list is pre-filled, and cancel it. Confirm the canceled practice **stays** on the calendar marked canceled rather than disappearing. Then check both screens in light and dark mode.

⚠️ If you created the series across late October into November in an American zone, confirm both occurrences show **the same local time**. That is the DST guarantee visible in the product.

- [ ] **Step 5: Commit**

```bash
git add frontend/app
git commit -m "Create a practice and review one"
```

---

### Task 16: Team roster management

**Files:**
- Create: `frontend/app/(app)/teams/[teamId].tsx`
- Modify: `frontend/app/(app)/(tabs)/calendar.tsx`

**Interfaces:**
- Consumes: `fetchTeam`, `addTeamMember`, `removeTeamMember` from `@/lib/api/teams`; `fetchRoster` from `@/lib/api/roster` (existing).
- Produces: the `/teams/[teamId]` route, reachable from the calendar header.

- [ ] **Step 1: Write the screen**

Create `frontend/app/(app)/teams/[teamId].tsx`:

```tsx
import { Avatar, Button, EmptyState, Screen, Section, Text } from "@/components/ui";
import { describeApiError } from "@/lib/api/client";
import { fetchRoster } from "@/lib/api/roster";
import { addTeamMember, fetchTeam, removeTeamMember } from "@/lib/api/teams";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Users } from "lucide-react-native";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";

export default function TeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const queryClient = useQueryClient();

  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => fetchTeam(teamId),
  });

  const team = teamQuery.data;
  const isCoach = team?.role === "coach";

  /** The coach's own roster, which is the only pool they may add from: the API
   * rejects an athlete they do not actively coach with a 404. Fetching it here
   * means the UI offers exactly what the API will accept. */
  const rosterQuery = useQuery({
    queryKey: ["roster"],
    queryFn: fetchRoster,
    enabled: Boolean(isCoach),
  });

  const addMutation = useMutation({
    mutationFn: (userId: string) => addTeamMember(teamId, userId, "athlete"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
    onError: (error: unknown) => Alert.alert("Could not add", describeApiError(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTeamMember(teamId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
    // A 409 here means "that's the last coach", which describeApiError surfaces
    // verbatim from the API's message.
    onError: (error: unknown) => Alert.alert("Could not remove", describeApiError(error)),
  });

  if (teamQuery.isLoading || !team) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  const memberIds = new Set(team.members.map((m) => m.user_id));
  const addable = (rosterQuery.data ?? []).filter(
    (athlete) => !memberIds.has(athlete.athlete_id),
  );

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-5 pb-8">
        <View className="gap-1">
          <Text variant="title">{team.name}</Text>
          <Text variant="caption" tone="muted">
            {team.timezone}
          </Text>
        </View>

        <Section label={`Members (${team.members.length})`}>
          {team.members.map((member) => (
            <View
              key={member.user_id}
              className="flex-row items-center gap-3 border-b border-hairline dark:border-hairline-dark py-3"
            >
              <Avatar uri={member.avatar_url} size={36} />
              <View className="flex-1">
                <Text variant="body">
                  {member.first_name} {member.last_name}
                </Text>
                <Text variant="caption" tone="muted">
                  {member.role === "coach" ? "Coach" : "Athlete"}
                </Text>
              </View>
              {isCoach ? (
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    Alert.alert(
                      "Remove from team?",
                      "Their past practices stay on record.",
                      [
                        { text: "Keep", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => removeMutation.mutate(member.user_id),
                        },
                      ],
                    )
                  }
                >
                  <Text variant="caption" tone="error">
                    Remove
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Section>

        {isCoach ? (
          <Section label="Add from your roster">
            {addable.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Everyone's already here"
                body="Every athlete on your roster is on this team. Invite more athletes from the Roster tab."
              />
            ) : (
              addable.map((athlete) => (
                <View
                  key={athlete.athlete_id}
                  className="flex-row items-center gap-3 py-2"
                >
                  <View className="flex-1">
                    <Text variant="body">
                      {athlete.first_name} {athlete.last_name}
                    </Text>
                  </View>
                  <Button
                    label="Add"
                    variant="secondary"
                    loading={
                      addMutation.isPending &&
                      addMutation.variables === athlete.athlete_id
                    }
                    onPress={() => addMutation.mutate(athlete.athlete_id)}
                  />
                </View>
              ))
            )}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
```

`fetchRoster()` returns `AthleteProfileView[]` from `GET /coach-requests/roster`, and the id field is `athlete_id` — verified against `lib/api/roster.ts:5` and its use in `roster.tsx`.

- [ ] **Step 2: Link to it from the calendar**

In `frontend/app/(app)/(tabs)/calendar.tsx`, make the team name in the header tappable:

```tsx
        <Pressable onPress={() => activeTeam && router.push(`/teams/${activeTeam.id}`)}>
          <Text variant="title">{activeTeam?.name}</Text>
        </Pressable>
```

Both roles may open it; only coaches see the add and remove controls, and the API enforces that independently.

- [ ] **Step 3: Verify classes, then the gates**

```bash
cd frontend && npx tailwindcss -i ./global.css -o /tmp/teams-out.css --config ./tailwind.config.js
npm run type-check && npm run lint
```

Check every `className` token against the compiled CSS. Expected: clean, zero dead classes.

- [ ] **Step 4: Exercise it**

As a coach with at least one athlete on the roster: open the team from the calendar header, add an athlete, confirm they appear in Members and disappear from the add list, then remove them. Try removing yourself as the only coach and confirm the 409 message surfaces in the alert rather than a generic failure. Check both modes.

- [ ] **Step 5: Run the full gate suite one last time**

```bash
cd backend && npm run lint && npx tsc --noEmit && npm run build && npm test
cd ../frontend && npm run lint && npm run type-check
```

Expected: all clean. `/ci-check` runs exactly this.

- [ ] **Step 6: Commit**

```bash
git add frontend/app
git commit -m "Manage who is on a team"
```

---

## Done when

- A coach can create a team, add athletes from their roster, schedule a recurring practice series, and cancel a single practice.
- An athlete on that team sees the calendar, the roster, and who is in each practice — and sees a canceled practice marked rather than gone.
- A series created across a DST boundary holds the same local time on every occurrence, proven by `recurrence.spec.ts`, by `events.service.spec.ts`, and end to end in `teams.e2e-spec.ts`.
- `docs/AUTHORIZATION.md` has a `### teams / events` section citing the enforcing function and the pinning test for every rule.
- All CI gates pass on both packages.

**Not done, and deliberately so:** video submission and review (the next spec), auto-attached programming, attendance and RSVP, team leaderboards, push notifications for a cancellation, deleting a team, and cancelling the remainder of a series.
