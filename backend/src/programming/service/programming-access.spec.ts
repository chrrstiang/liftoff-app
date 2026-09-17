import { PgDialect } from 'drizzle-orm/pg-core';
import { historyVisibilityFilter } from './programming-access';

/** The history row filter, asserted as the SQL it actually compiles to.
 *
 * ⚠️ **This is the only place the narrow co-coach rule is pinned.** The mocked
 * Drizzle client in `db-mock.ts` routes results by table and ignores `where`
 * entirely — by design, so specs survive query reordering — which means a service
 * spec **cannot** show that a filter excluded a row. Dropping the `coach_id` term
 * from `historyVisibilityFilter` would leave every test in
 * `workouts.service.spec.ts` green while newly exposing one coach's programming to
 * another.
 *
 * So this compiles the filter through the real Postgres dialect and reads the
 * clause. It is not a mock of the rule; it is the rule.
 */
describe('historyVisibilityFilter', () => {
  const ATHLETE = '22222222-2222-4222-8222-222222222222';
  const COACH_A = '11111111-1111-4111-8111-111111111111';

  const compile = (athleteId: string, callerId: string) =>
    new PgDialect().sqlToQuery(historyVisibilityFilter(athleteId, callerId)!);

  it('scopes an athlete reading their own history to their own workouts', () => {
    const { sql, params } = compile(ATHLETE, ATHLETE);

    expect(sql).toBe('"workouts"."athlete_id" = $1');
    expect(params).toEqual([ATHLETE]);
  });

  /** The athlete owns everything assigned to them regardless of which of their
   * coaches wrote it, so no `coach_id` restriction applies to them. */
  it('does not restrict an athlete by who authored the workout', () => {
    expect(compile(ATHLETE, ATHLETE).sql).not.toContain('coach_id');
  });

  /** ⚠️ **The narrow rule, deliberately.** An athlete may have more than one
   * coach. A coach reading their athlete's history sees only the sessions they
   * authored — the same rule `loadReadableWorkout` applies to a single workout.
   *
   * Widening this to "any active coach of this athlete sees all of it" is a
   * pending product decision, not a bug. **If that decision is made, change this
   * test on purpose.** Making it pass by accident is how one coach's programming
   * leaks to another. */
  it('restricts a coach to the workouts they authored, not every session the athlete has', () => {
    const { sql, params } = compile(ATHLETE, COACH_A);

    expect(sql).toBe('("workouts"."athlete_id" = $1 and "workouts"."coach_id" = $2)');
    expect(params).toEqual([ATHLETE, COACH_A]);
  });

  /** Both ids are bound parameters rather than interpolated text. An earlier
   * Drizzle port shipped a `where` with a value spliced into the template. */
  it('binds both ids as parameters rather than interpolating them', () => {
    const { sql, params } = compile(ATHLETE, COACH_A);

    expect(sql).not.toContain(ATHLETE);
    expect(sql).not.toContain(COACH_A);
    expect(params).toHaveLength(2);
  });
});
