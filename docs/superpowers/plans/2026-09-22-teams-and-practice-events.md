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
| `backend/src/teams/service/recurrence.spec.ts` | DST correctness and the expansion bounds |
| `backend/src/teams/service/teams.service.ts` | Team CRUD and membership |
| `backend/src/teams/service/teams.service.spec.ts` | Team service rules against the mocked client |
| `backend/src/teams/service/events.service.ts` | Event CRUD, series expansion, participants |
| `backend/src/teams/service/events.service.spec.ts` | Event service rules against the mocked client |
| `backend/src/teams/controller/teams.controller.ts` | Routes under `/teams` |
| `backend/src/teams/controller/events.controller.ts` | Routes under `/events` |
| `backend/src/teams/dto/team.dto.ts` | `CreateTeamDto`, `UpdateTeamDto`, `AddTeamMemberDto` |
| `backend/src/teams/dto/team.dto.spec.ts` | Timezone and name validation |
| `backend/src/teams/dto/event.dto.ts` | `CreateEventDto`, `RecurrenceDto`, `UpdateEventDto`, `EventQueryDto`, `AddParticipantDto` |
| `backend/src/teams/dto/event.dto.spec.ts` | Time ordering, required end date, span cap |
| `backend/src/teams/dto/is-iana-timezone.validator.ts` | `@IsIanaTimeZone()`. No DB, so no `ValidatorsModule` registration |
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
  - `MAX_SERIES_WEEKS = 52`, `MAX_OCCURRENCES = 500`
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
import { expandSeries, MAX_OCCURRENCES, zonedWallTimeToInstant } from './recurrence';

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

  /** A fat-fingered daily series is otherwise one request that writes tens of
   * thousands of rows. The cap is below the 52-week limit for daily recurrence,
   * so it has to be its own check. */
  it('rejects an expansion over the occurrence cap', () => {
    expect(() =>
      expandSeries(
        {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          startTime: '17:00',
          durationMinutes: 60,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
        NY,
      ),
    ).toThrow(new RegExp(String(MAX_OCCURRENCES)));
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

export const MAX_SERIES_WEEKS = 52;
export const MAX_OCCURRENCES = 500;

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

    if (occurrences.length > MAX_OCCURRENCES) {
      throw new Error(`A series may not expand to more than ${MAX_OCCURRENCES} occurrences`);
    }
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
