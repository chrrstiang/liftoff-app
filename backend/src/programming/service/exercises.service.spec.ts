import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { ExercisesService } from './exercises.service';

/** Creating a library exercise.
 *
 * ⚠️ **Why duplicate names stopped being harmless.** `athlete_maxes` keys on
 * `exercise_id`, so three rows called "Back Squat" accumulate three separate
 * squat maxes for the same athlete doing the same lift — and a percentage
 * prescription resolves against whichever duplicate the coach happened to pick.
 */
describe('ExercisesService.createExercise', () => {
  const COACH = '11111111-1111-4111-8111-111111111111';
  const EXISTING = '55555555-5555-4555-8555-555555555555';

  let harness: TestDb;
  let service: ExercisesService;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExercisesService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<ExercisesService>(ExercisesService);
  }

  it('still refuses a caller who is not a coach', async () => {
    await build({ coaches: [[]] });

    await expect(service.createExercise('Back Squat', COACH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(harness.writes).toHaveLength(0);
  });

  /** A coach typing a name they already have means "use that one". Before the
   * index they got a second row instead, silently splitting their athlete's max. */
  it('returns the existing exercise instead of creating a second', async () => {
    await build({
      coaches: [[{ id: COACH }]],
      exercises: [[{ id: EXISTING, name: 'Back Squat' }]],
    });

    const result = await service.createExercise('Back Squat', COACH);

    expect(result).toEqual({ id: EXISTING, name: 'Back Squat' });
    expect(harness.writes).toHaveLength(0);
  });

  it('creates one when the coach has no exercise by that name', async () => {
    await build({
      coaches: [[{ id: COACH }]],
      // lookup finds nothing, then the insert returns the new row
      exercises: [[], [{ id: 'new-id', name: 'Tempo Squat' }]],
    });

    const result = await service.createExercise('Tempo Squat', COACH);

    expect(result).toEqual({ id: 'new-id', name: 'Tempo Squat' });
    expect(harness.writes.some((w) => w.op === 'insert' && w.table === 'exercises')).toBe(true);
  });

  /** Losing the race is the same outcome the caller wanted: the winner's row.
   * Failing the second create would be correct and useless. */
  it('returns the winner when it loses a race to another create', async () => {
    const harnessed = makeTestDb({
      coaches: [[{ id: COACH }]],
      exercises: [[], [{ id: EXISTING, name: 'Back Squat' }]],
    });

    const violation = Object.assign(new Error('duplicate key'), { code: '23505' });
    const db = harnessed.db as unknown as Record<string, unknown>;
    db.insert = () => {
      throw violation;
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExercisesService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    const svc = module.get<ExercisesService>(ExercisesService);

    await expect(svc.createExercise('Back Squat', COACH)).resolves.toEqual({
      id: EXISTING,
      name: 'Back Squat',
    });
  });

  /** Anything that is not 23505 keeps propagating. Swallowing every insert
   * failure would hide real breakage behind a plausible success. */
  it('rethrows an error that is not a unique violation', async () => {
    const harnessed = makeTestDb({ coaches: [[{ id: COACH }]], exercises: [[]] });

    const other = Object.assign(new Error('connection reset'), { code: '08006' });
    const db = harnessed.db as unknown as Record<string, unknown>;
    db.insert = () => {
      throw other;
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExercisesService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    const svc = module.get<ExercisesService>(ExercisesService);

    await expect(svc.createExercise('Back Squat', COACH)).rejects.toThrow(/connection reset/);
  });
});
