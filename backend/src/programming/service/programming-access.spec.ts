import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from 'src/db/db.module';
import { makeTestDb } from 'src/db/testing/db-mock';
import {
  historyVisibilityFilter,
  loadProgrammableWorkout,
  loadReadableWorkout,
} from './programming-access';

const ATHLETE = '22222222-2222-4222-8222-222222222222';
const COACH_A = '11111111-1111-4111-8111-111111111111';
const COACH_B = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const WORKOUT = '55555555-5555-4555-8555-555555555555';

/** An active coach_athlete_relationships row. Only its presence matters — the
 * mocked client ignores `where`, so scripting one row is what "a relationship
 * exists" means here, and scripting none is what "it does not" means. */
const ACTIVE_RELATIONSHIP = [{ id: 'rel' }];

const db = (script: Parameters<typeof makeTestDb>[0]) =>
  makeTestDb(script).db as unknown as Database;

/** The history row filter, asserted as the SQL it actually compiles to.
 *
 * ⚠️ **This is the only place the co-coach read rule is pinned.** The mocked
 * Drizzle client in `db-mock.ts` routes results by table and ignores `where`
 * entirely — by design, so specs survive query reordering — which means a service
 * spec **cannot** show that a filter included or excluded a row. Re-adding a
 * `coach_id` term here would leave every test in `workouts.service.spec.ts` green
 * while silently hiding one coach's programming from another.
 *
 * So this compiles the filter through the real Postgres dialect and reads the
 * clause. It is not a mock of the rule; it is the rule.
 */
describe('historyVisibilityFilter', () => {
  const compile = (athleteId: string) =>
    new PgDialect().sqlToQuery(historyVisibilityFilter(athleteId));

  it('scopes an athlete reading their own history to their own workouts', () => {
    const { sql, params } = compile(ATHLETE);

    expect(sql).toBe('"workouts"."athlete_id" = $1');
    expect(params).toEqual([ATHLETE]);
  });

  /** ⚠️ **This test was inverted on purpose (2026-09-20).** It previously asserted
   * that a coach saw only the sessions they authored. An athlete may have more than
   * one coach, and co-coaches now see each other's programming — a coach writing
   * next week needs to know what the athlete actually did, including under someone
   * else, and three coaches sharing a spreadsheet had that for free.
   *
   * If the decision is ever reversed again, change this test on purpose. Making it
   * pass by accident is how the rule drifts. */
  it('does not restrict a coach to the workouts they authored', () => {
    const { sql, params } = compile(ATHLETE);

    expect(sql).toBe('"workouts"."athlete_id" = $1');
    expect(sql).not.toContain('coach_id');
    expect(params).toEqual([ATHLETE]);
  });

  /** The filter takes an athlete and nothing else, so it cannot vary by caller
   * even by accident. Re-adding a `callerId` parameter is the first move of any
   * change that re-narrows this rule, so the arity is worth pinning. */
  it('takes only an athlete id, so it cannot vary by caller', () => {
    expect(historyVisibilityFilter).toHaveLength(1);
  });

  /** The id is a bound parameter rather than interpolated text. An earlier Drizzle
   * port shipped a `where` with a value spliced into the template. */
  it('binds the athlete id as a parameter rather than interpolating it', () => {
    const { sql, params } = compile(ATHLETE);

    expect(sql).not.toContain(ATHLETE);
    expect(params).toHaveLength(1);
  });
});

/** Reads are wide, writes are narrow. These two describes are the asymmetry. */
describe('loadReadableWorkout', () => {
  const assigned = [{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH_A }];

  it('lets the athlete read their own workout', async () => {
    const result = await loadReadableWorkout(db({ workouts: [assigned] }), WORKOUT, ATHLETE);
    expect(result.id).toBe(WORKOUT);
  });

  it('lets the authoring coach read it without consulting relationships', async () => {
    const result = await loadReadableWorkout(db({ workouts: [assigned] }), WORKOUT, COACH_A);
    expect(result.id).toBe(WORKOUT);
  });

  /** The change. Coach B did not write this workout but actively coaches the
   * athlete, so they may read it — otherwise a co-coach sees the session listed in
   * history and gets a 404 opening it, which reads as a broken app. */
  it('lets a co-coach read a workout another coach authored', async () => {
    const result = await loadReadableWorkout(
      db({ workouts: [assigned], coach_athlete_relationships: [ACTIVE_RELATIONSHIP] }),
      WORKOUT,
      COACH_B,
    );

    expect(result.id).toBe(WORKOUT);
  });

  it('still 404s a caller with no relationship to the athlete', async () => {
    await expect(
      loadReadableWorkout(
        db({ workouts: [assigned], coach_athlete_relationships: [[]] }),
        WORKOUT,
        STRANGER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /** A template has no athlete, so there is nobody to be a co-coach *of*. Without
   * the null guard this would ask `isActiveCoachOf(caller, null)`. Scripting a
   * relationship row proves the guard runs: if the lookup happened at all, the
   * scripted row would let the wrong caller through. */
  it('does not open a template to another coach even if a relationship exists', async () => {
    const template = [{ id: WORKOUT, athleteId: null, coachId: COACH_A }];

    await expect(
      loadReadableWorkout(
        db({ workouts: [template], coach_athlete_relationships: [ACTIVE_RELATIONSHIP] }),
        WORKOUT,
        COACH_B,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a workout that does not exist', async () => {
    await expect(
      loadReadableWorkout(db({ workouts: [[]] }), WORKOUT, COACH_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('loadProgrammableWorkout', () => {
  const assigned = [{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH_A }];

  it('lets the authoring coach change the workout', async () => {
    const result = await loadProgrammableWorkout(db({ workouts: [assigned] }), WORKOUT, COACH_A);
    expect(result.id).toBe(WORKOUT);
  });

  /** ⚠️ **The write half of the asymmetry, and the reason it is worth a test.**
   * Widening reads must NOT widen writes: a co-coach silently rewriting or deleting
   * another coach's programming is a far larger blast radius than reading it.
   *
   * The 403 rather than 404 is correct here. 404-over-403 exists so a caller with
   * no claim cannot confirm the id is real; a co-coach already has a claim, so the
   * 403 tells them nothing they could not already see — and "not yours to change"
   * is the more useful answer than "does not exist". */
  it('refuses a co-coach with a 403, not a 404', async () => {
    await expect(
      loadProgrammableWorkout(
        db({ workouts: [assigned], coach_athlete_relationships: [ACTIVE_RELATIONSHIP] }),
        WORKOUT,
        COACH_B,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /** The athlete may log what they lifted (`isPerformer`) but never restructure
   * the prescription they were given. */
  it('refuses the athlete', async () => {
    await expect(
      loadProgrammableWorkout(db({ workouts: [assigned] }), WORKOUT, ATHLETE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s a stranger rather than revealing the workout exists', async () => {
    await expect(
      loadProgrammableWorkout(
        db({ workouts: [assigned], coach_athlete_relationships: [[]] }),
        WORKOUT,
        STRANGER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
