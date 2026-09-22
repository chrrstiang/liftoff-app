import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { AdherenceService } from './adherence.service';
import { MAX_ADHERENCE_DAYS } from '../dto/adherence-query.dto';

/** Adherence — who on the roster is doing the work.
 *
 * ⚠️ **What these tests can and cannot show.** The mocked Drizzle client ignores
 * `where` and never sends SQL anywhere, so it cannot prove this query is scoped
 * to the caller's roster, nor that it compiles at all. That half was verified by
 * executing the real service against local Postgres, which is how a missing
 * `cast(... as int)` on the window parameter was found — the query failed
 * outright at execution and every mocked test would have stayed green.
 *
 * What is left for a unit test is the ordering, which is pure and is the thing a
 * coach actually reads.
 */
describe('AdherenceService', () => {
  const COACH = '11111111-1111-4111-8111-111111111111';

  let harness: TestDb;
  let service: AdherenceService;

  async function build(rows: unknown[]) {
    harness = makeTestDb({ coach_athlete_relationships: [rows] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdherenceService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<AdherenceService>(AdherenceService);
  }

  const row = (over: Record<string, unknown>) => ({
    athlete_id: 'a',
    first_name: 'A',
    last_name: 'B',
    username: 'ab',
    workouts_assigned: 1,
    workouts_started: 0,
    sets_prescribed: 10,
    sets_completed: 5,
    ...over,
  });

  /** A coach opens this to find who needs attention, not to admire the athlete
   * who did everything. The answer belongs at the top. */
  it('orders the worst adherence first', async () => {
    await build([
      row({ athlete_id: 'good', sets_prescribed: 10, sets_completed: 10 }),
      row({ athlete_id: 'bad', sets_prescribed: 10, sets_completed: 1 }),
      row({ athlete_id: 'middling', sets_prescribed: 10, sets_completed: 6 }),
    ]);

    const result = await service.listAdherence(undefined, COACH);

    expect(result.map((r) => r.athlete_id)).toEqual(['bad', 'middling', 'good']);
  });

  /** ⚠️ An athlete with nothing prescribed is **not** behind — they are
   * unprogrammed, which is the coach's own omission rather than the athlete's.
   * Sorting them to the top as "0%" would bury the athletes who actually skipped
   * work, which is the one thing this screen exists to surface. */
  it('sorts an athlete with nothing prescribed last, not first', async () => {
    await build([
      row({ athlete_id: 'unprogrammed', sets_prescribed: 0, sets_completed: 0 }),
      row({ athlete_id: 'skipping', sets_prescribed: 10, sets_completed: 0 }),
    ]);

    const result = await service.listAdherence(undefined, COACH);

    expect(result.map((r) => r.athlete_id)).toEqual(['skipping', 'unprogrammed']);
  });

  it('compares by ratio rather than by raw count completed', async () => {
    await build([
      // 20 of 100 is worse adherence than 5 of 10, despite four times the volume.
      row({ athlete_id: 'high-volume', sets_prescribed: 100, sets_completed: 20 }),
      row({ athlete_id: 'low-volume', sets_prescribed: 10, sets_completed: 5 }),
    ]);

    const result = await service.listAdherence(undefined, COACH);

    expect(result.map((r) => r.athlete_id)).toEqual(['high-volume', 'low-volume']);
  });

  it('returns an empty list for a caller with no roster', async () => {
    await build([]);

    await expect(service.listAdherence(undefined, COACH)).resolves.toEqual([]);
  });

  /** The cap is applied in the service, not only in the DTO, so it holds for any
   * future caller that does not arrive over HTTP. */
  it('caps the window even when handed a larger one', async () => {
    await build([]);

    await expect(service.listAdherence(MAX_ADHERENCE_DAYS + 500, COACH)).resolves.toEqual([]);
  });

  it('issues no writes', async () => {
    await build([row({})]);

    await service.listAdherence(undefined, COACH);

    expect(harness.writes).toHaveLength(0);
  });
});
