import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { WorkoutsService } from './workouts.service';
import type { CreateWorkoutDto } from '../dto/create-workout.dto';

/** WorkoutsService — the authorization rules and the payload invariants.
 *
 * ⚠️ **These are the rules that replace RLS.** There is nothing in the database
 * that will stop a caller reading or writing another user's training, so each
 * assertion below is load-bearing rather than a nicety.
 *
 * What a unit test can and cannot show here:
 *  - it *can* show that a rule rejects, and that a rejected write issues no INSERT
 *  - it *cannot* show that a transaction rolls back, or that the SQL is valid
 *
 * The second half is why the e2e suite exists. Two bugs in the earlier Drizzle port
 * — an `undefined` interpolated into a `where`, and a malformed uuid surfacing as a
 * 500 — were both invisible to mocked specs by construction.
 */
describe('WorkoutsService', () => {
  const COACH = '11111111-1111-4111-8111-111111111111';
  const ATHLETE = '22222222-2222-4222-8222-222222222222';
  const STRANGER = '33333333-3333-4333-8333-333333333333';
  const EXERCISE = '44444444-4444-4444-8444-444444444444';
  const WORKOUT = '55555555-5555-4555-8555-555555555555';
  const SET = '66666666-6666-4666-8666-666666666666';

  let service: WorkoutsService;
  let harness: TestDb;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkoutsService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  }

  /** A minimal valid body: one exercise, two sets. */
  const body = (overrides: Partial<CreateWorkoutDto> = {}): CreateWorkoutDto => ({
    name: 'Squat day',
    date: '2026-08-20',
    athlete_id: ATHLETE,
    exercises: [
      {
        exercise_id: EXERCISE,
        order: 0,
        sets: [
          { set_number: 1, prescribed_reps: 5 },
          { set_number: 2, prescribed_reps: 5 },
        ],
      },
    ],
    ...overrides,
  });

  /** Everything createWorkout reads on the happy path. */
  const happyPath = () => ({
    coaches: [[{ id: COACH }]],
    athletes: [[{ id: ATHLETE }]],
    coach_athlete_relationships: [[{ id: 'rel-1' }]],
    exercises: [[{ id: EXERCISE }]],
    workouts: [[{ id: WORKOUT }]],
    workout_exercises: [[{ id: 'we-1', order: 0 }]],
    sets: [[]],
  });

  describe('createWorkout', () => {
    it('creates the workout, its exercises and its sets in a transaction', async () => {
      await build(happyPath());

      const result = await service.createWorkout(body(), COACH);

      expect(result).toEqual({ id: WORKOUT });
      expect(harness.transactions).toBe(1);
      expect(harness.writes.map((w) => `${w.op} ${w.table}`)).toEqual([
        'insert workouts',
        'insert workout_exercises',
        'insert sets',
      ]);
    });

    /** The invariant the old client broke: coach_id came from the request body, so
     * any user could attribute a workout to any coach. */
    it('attributes the workout to the caller, never to a body field', async () => {
      await build(happyPath());

      await service.createWorkout(body(), COACH);

      const insert = harness.writes.find((w) => w.table === 'workouts');
      expect(insert!.values).toMatchObject({ coachId: COACH, athleteId: ATHLETE });
    });

    it('rejects a caller with no coaches row', async () => {
      await build({ coaches: [[]] });

      await expect(service.createWorkout(body(), STRANGER)).rejects.toThrow(ForbiddenException);
      expect(harness.writes).toHaveLength(0);
    });

    it('rejects programming for an athlete who is not on the roster', async () => {
      await build({
        coaches: [[{ id: COACH }]],
        athletes: [[{ id: ATHLETE }]],
        // No active relationship.
        coach_athlete_relationships: [[]],
      });

      await expect(service.createWorkout(body(), COACH)).rejects.toThrow(ForbiddenException);
      expect(harness.writes).toHaveLength(0);
    });

    it('404s when the named athlete does not exist', async () => {
      await build({ coaches: [[{ id: COACH }]], athletes: [[]] });

      await expect(service.createWorkout(body(), COACH)).rejects.toThrow(NotFoundException);
    });

    /** A template has no athlete, so there is no roster check to make and
     * `is_template` must come out true. */
    it('treats a workout with no athlete as a template and skips the roster check', async () => {
      await build({
        coaches: [[{ id: COACH }]],
        exercises: [[{ id: EXERCISE }]],
        workouts: [[{ id: WORKOUT }]],
        workout_exercises: [[{ id: 'we-1', order: 0 }]],
        sets: [[]],
      });

      await service.createWorkout(body({ athlete_id: null }), COACH);

      const insert = harness.writes.find((w) => w.table === 'workouts');
      expect(insert!.values).toMatchObject({ athleteId: null, isTemplate: true });
    });

    /** The bug that made the template list permanently empty: nothing ever wrote
     * this column, so it was NULL and `= true` matched nothing. */
    it('always writes is_template rather than leaving it NULL', async () => {
      await build(happyPath());

      await service.createWorkout(body(), COACH);

      const insert = harness.writes.find((w) => w.table === 'workouts');
      expect(insert!.values).toMatchObject({ isTemplate: false });
    });

    it('rejects an exercise that is not in the caller’s library', async () => {
      await build({
        coaches: [[{ id: COACH }]],
        athletes: [[{ id: ATHLETE }]],
        coach_athlete_relationships: [[{ id: 'rel-1' }]],
        exercises: [[]],
      });

      await expect(service.createWorkout(body(), COACH)).rejects.toThrow(
        /Unknown exercise: '44444444/,
      );
      expect(harness.writes).toHaveLength(0);
    });

    /** Duplicate orders would make the sets of one exercise land on another,
     * because the insert pairs sets to exercises by `order`. */
    it('rejects duplicate exercise orders', async () => {
      await build(happyPath());

      const dto = body({
        exercises: [
          { exercise_id: EXERCISE, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          { exercise_id: EXERCISE, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
        ],
      });

      await expect(service.createWorkout(dto, COACH)).rejects.toThrow(/Duplicate exercise order 0/);
      expect(harness.writes).toHaveLength(0);
    });

    it('rejects duplicate set numbers within one exercise', async () => {
      await build(happyPath());

      const dto = body({
        exercises: [
          {
            exercise_id: EXERCISE,
            order: 0,
            sets: [
              { set_number: 1, prescribed_reps: 5 },
              { set_number: 1, prescribed_reps: 3 },
            ],
          },
        ],
      });

      await expect(service.createWorkout(dto, COACH)).rejects.toThrow(/Duplicate set_number 1/);
      expect(harness.writes).toHaveLength(0);
    });

    it('pairs sets to their exercise by order, not by array index', async () => {
      await build({
        coaches: [[{ id: COACH }]],
        athletes: [[{ id: ATHLETE }]],
        coach_athlete_relationships: [[{ id: 'rel-1' }]],
        exercises: [[{ id: EXERCISE }]],
        workouts: [[{ id: WORKOUT }]],
        // Returned in the reverse of the order they were supplied.
        workout_exercises: [
          [
            { id: 'we-second', order: 1 },
            { id: 'we-first', order: 0 },
          ],
        ],
        sets: [[]],
      });

      const dto = body({
        exercises: [
          { exercise_id: EXERCISE, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          { exercise_id: EXERCISE, order: 1, sets: [{ set_number: 1, prescribed_reps: 8 }] },
        ],
      });

      await service.createWorkout(dto, COACH);

      const setInsert = harness.writes.find((w) => w.table === 'sets')!.values as Array<{
        workoutExerciseId: string;
        prescribedReps: number;
      }>;

      expect(setInsert).toEqual([
        expect.objectContaining({ workoutExerciseId: 'we-first', prescribedReps: 5 }),
        expect.objectContaining({ workoutExerciseId: 'we-second', prescribedReps: 8 }),
      ]);
    });
  });

  describe('updateSet', () => {
    const assigned = { id: WORKOUT, athleteId: ATHLETE, coachId: COACH };

    it('lets the athlete log their own set', async () => {
      await build({
        sets: [[assigned], [{ id: SET, set_number: 1, actual_load: 100, is_completed: true }]],
      });

      const result = await service.updateSet(
        SET,
        { actual_load: 100, is_completed: true },
        ATHLETE,
      );

      expect(result).toMatchObject({ id: SET, actual_load: 100 });
      expect(harness.writes).toEqual([{ op: 'update', table: 'sets' }]);
    });

    /** The coach owns the prescription, not the record of execution. Letting them
     * write actual_load means the log stops being evidence of what was lifted. */
    it('forbids the coach from logging their athlete’s set', async () => {
      await build({ sets: [[assigned]] });

      await expect(service.updateSet(SET, { actual_load: 200 }, COACH)).rejects.toThrow(
        ForbiddenException,
      );
      expect(harness.writes).toHaveLength(0);
    });

    /** On a template nobody performs the work, so the owning coach may fill in the
     * fields while building it. */
    it('lets the coach write to a set on their own template', async () => {
      await build({
        sets: [[{ id: WORKOUT, athleteId: null, coachId: COACH }], [{ id: SET }]],
      });

      await expect(service.updateSet(SET, { actual_load: 100 }, COACH)).resolves.toBeDefined();
    });

    /** A 404 rather than a 403, so a stranger cannot use the status code to
     * confirm that a set id is real. */
    it('404s for a caller with no claim on the set', async () => {
      await build({ sets: [[assigned]] });

      await expect(service.updateSet(SET, { actual_load: 100 }, STRANGER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when the set does not exist', async () => {
      await build({ sets: [[]] });

      await expect(service.updateSet(SET, { actual_load: 100 }, ATHLETE)).rejects.toThrow(
        NotFoundException,
      );
    });

    /** An empty patch would compile to `update sets set where id = ...`, which is
     * a syntax error rather than a no-op. */
    it('rejects an empty patch instead of issuing an UPDATE with no columns', async () => {
      await build({ sets: [[assigned]] });

      await expect(service.updateSet(SET, {}, ATHLETE)).rejects.toThrow(BadRequestException);
      expect(harness.writes).toHaveLength(0);
    });

    /** `null` clears a value and must be distinguishable from an omitted field. */
    it('treats an explicit null as a value to write', async () => {
      await build({ sets: [[assigned], [{ id: SET }]] });

      await service.updateSet(SET, { actual_load: null }, ATHLETE);

      expect(harness.writes).toEqual([{ op: 'update', table: 'sets' }]);
    });
  });

  describe('addExercise', () => {
    it('requires exactly one of exercise_id or name', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(
        service.addExercise(WORKOUT, { sets: [{ set_number: 1, prescribed_reps: 5 }] }, COACH),
      ).rejects.toThrow(/exactly one of exercise_id or name/);
    });

    it('rejects both being supplied', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(
        service.addExercise(
          WORKOUT,
          { exercise_id: EXERCISE, name: 'Squat', sets: [{ set_number: 1, prescribed_reps: 5 }] },
          COACH,
        ),
      ).rejects.toThrow(/exactly one of exercise_id or name/);
    });

    /** Structure is the coach's to change. An athlete who can add exercises can
     * rewrite the program they were given. */
    it('forbids the athlete from changing the structure of their workout', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(
        service.addExercise(
          WORKOUT,
          { exercise_id: EXERCISE, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          ATHLETE,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(harness.writes).toHaveLength(0);
    });

    it('404s for a stranger rather than revealing the workout exists', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(
        service.addExercise(
          WORKOUT,
          { exercise_id: EXERCISE, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          STRANGER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the library exercise when given a name', async () => {
      await build({
        workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]],
        exercises: [[{ id: 'new-ex' }]],
        workout_exercises: [[{ order: 2 }], [{ id: 'we-new' }]],
        sets: [[]],
      });

      const result = await service.addExercise(
        WORKOUT,
        { name: 'Paused Bench', sets: [{ set_number: 1, prescribed_reps: 5 }] },
        COACH,
      );

      expect(result).toMatchObject({ exercise_id: 'new-ex' });
      const created = harness.writes.find((w) => w.table === 'exercises');
      expect(created!.values).toMatchObject({ name: 'Paused Bench', createdBy: COACH });
    });

    /** Appending must not reuse an order already taken, which is what the old
     * array-index approach did once an exercise had been removed. */
    it('appends after the highest existing order when none is given', async () => {
      await build({
        workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]],
        exercises: [[{ id: EXERCISE }]],
        workout_exercises: [[{ order: 4 }], [{ id: 'we-new' }]],
        sets: [[]],
      });

      const result = await service.addExercise(
        WORKOUT,
        { exercise_id: EXERCISE, sets: [{ set_number: 1, prescribed_reps: 5 }] },
        COACH,
      );

      expect(result).toMatchObject({ order: 5 });
    });

    it('starts at order 0 on an empty workout', async () => {
      await build({
        workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]],
        exercises: [[{ id: EXERCISE }]],
        workout_exercises: [[], [{ id: 'we-new' }]],
        sets: [[]],
      });

      const result = await service.addExercise(
        WORKOUT,
        { exercise_id: EXERCISE, sets: [{ set_number: 1, prescribed_reps: 5 }] },
        COACH,
      );

      expect(result).toMatchObject({ order: 0 });
    });
  });

  describe('listAthleteWorkouts', () => {
    it('lets the athlete read their own', async () => {
      await build({ workouts: [[{ id: WORKOUT, name: 'Squat day', date: '2026-08-20' }]] });

      await expect(service.listAthleteWorkouts(ATHLETE, ATHLETE)).resolves.toHaveLength(1);
    });

    it('lets an active coach read their athlete’s', async () => {
      await build({
        coach_athlete_relationships: [[{ id: 'rel-1' }]],
        workouts: [[{ id: WORKOUT, name: 'Squat day', date: '2026-08-20' }]],
      });

      await expect(service.listAthleteWorkouts(ATHLETE, COACH)).resolves.toHaveLength(1);
    });

    it('404s for anyone else', async () => {
      await build({ coach_athlete_relationships: [[]] });

      await expect(service.listAthleteWorkouts(ATHLETE, STRANGER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findWorkout', () => {
    it('404s for a caller who is neither the athlete nor the coach', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(service.findWorkout(WORKOUT, STRANGER)).rejects.toThrow(NotFoundException);
    });

    it('404s when the workout does not exist', async () => {
      await build({ workouts: [[]] });

      await expect(service.findWorkout(WORKOUT, ATHLETE)).rejects.toThrow(NotFoundException);
    });

    /** Falls back to the library name so the client never renders a blank heading;
     * display_name is nullable. */
    it('falls back to the library name when display_name is null', async () => {
      await build({
        workouts: [
          [{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }],
          [{ id: WORKOUT, name: 'Squat day' }],
        ],
        workout_exercises: [
          [
            {
              id: 'we-1',
              name: null,
              order: 0,
              exercise_id: EXERCISE,
              exercise_name: 'Back Squat',
            },
          ],
        ],
        sets: [[{ id: SET, workout_exercise_id: 'we-1', set_number: 1 }]],
      });

      const result = await service.findWorkout(WORKOUT, ATHLETE);

      expect(result.workout_exercises[0].name).toBe('Back Squat');
      expect(result.workout_exercises[0].sets).toHaveLength(1);
    });

    it('does not query sets at all when the workout has no exercises', async () => {
      await build({
        workouts: [
          [{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }],
          [{ id: WORKOUT, name: 'Empty' }],
        ],
        workout_exercises: [[]],
      });

      const result = await service.findWorkout(WORKOUT, ATHLETE);

      expect(result.workout_exercises).toEqual([]);
    });
  });

  describe('deleteWorkout', () => {
    /** The foreign keys have no `on delete cascade`, so children must go first or
     * the delete fails on the constraint. */
    it('deletes sets, then exercises, then the workout', async () => {
      await build({
        workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]],
        workout_exercises: [[{ id: 'we-1' }]],
      });

      await service.deleteWorkout(WORKOUT, COACH);

      expect(harness.writes.map((w) => `${w.op} ${w.table}`)).toEqual([
        'delete sets',
        'delete workout_exercises',
        'delete workouts',
      ]);
    });

    it('forbids the athlete from deleting their workout', async () => {
      await build({ workouts: [[{ id: WORKOUT, athleteId: ATHLETE, coachId: COACH }]] });

      await expect(service.deleteWorkout(WORKOUT, ATHLETE)).rejects.toThrow(ForbiddenException);
      expect(harness.writes).toHaveLength(0);
    });
  });
});
