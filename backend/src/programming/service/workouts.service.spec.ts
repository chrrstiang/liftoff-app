import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { WorkoutsService } from './workouts.service';
import type { CreateWorkoutDto } from '../dto/create-workout.dto';
import { MAX_HISTORY_LIMIT, type HistoryQueryDto } from '../dto/history-query.dto';

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

  describe('listWorkoutHistory', () => {
    const query = (overrides: Partial<HistoryQueryDto> = {}): HistoryQueryDto => ({
      athlete_id: ATHLETE,
      before: '2026-09-17',
      ...overrides,
    });

    /** Two exercises, three sets, two of them logged — and the second exercise
     * carries no sets at all, which is what the left join produces as a null
     * `set_id`. */
    const oneWorkout = () => ({
      workouts: [[{ id: WORKOUT, name: 'Squat day', date: '2026-09-10', notes: null }]],
      workout_exercises: [
        [
          { workout_id: WORKOUT, workout_exercise_id: 'we-1', set_id: 's-1', is_completed: true },
          { workout_id: WORKOUT, workout_exercise_id: 'we-1', set_id: 's-2', is_completed: true },
          { workout_id: WORKOUT, workout_exercise_id: 'we-1', set_id: 's-3', is_completed: false },
          { workout_id: WORKOUT, workout_exercise_id: 'we-2', set_id: null, is_completed: null },
        ],
      ],
    });

    it('lets the athlete read their own history', async () => {
      await build(oneWorkout());

      const result = await service.listWorkoutHistory(query(), ATHLETE);

      expect(result.workouts).toHaveLength(1);
      expect(result.has_more).toBe(false);
    });

    /** The *gate*, not the row filter. This proves an active coach gets past
     * `assertReadableAthlete`; it says nothing about which of the athlete's
     * workouts come back, because the mock ignores `where`. The narrow co-coach
     * scope is pinned in `programming-access.spec.ts`. */
    it('lets an active coach past the gate on their athlete’s history', async () => {
      await build({ coach_athlete_relationships: [[{ id: 'rel-1' }]], ...oneWorkout() });

      const result = await service.listWorkoutHistory(query(), COACH);

      expect(result.workouts).toHaveLength(1);
    });

    /** The rule that replaces RLS on this route. A 404 rather than a 403, so the
     * status code cannot be used to confirm that an id belongs to an athlete. */
    it('404s for a caller with no claim on the athlete', async () => {
      await build({ coach_athlete_relationships: [[]], ...oneWorkout() });

      await expect(service.listWorkoutHistory(query(), STRANGER)).rejects.toThrow(
        NotFoundException,
      );
    });

    /** A coach with a *pending* invite is not a coach yet. Sending an invite must
     * not be enough to read someone's training log. */
    it('404s for a coach whose relationship is not active', async () => {
      // isActiveCoachOf filters on status in SQL, so a pending row is simply no row.
      await build({ coach_athlete_relationships: [[]], ...oneWorkout() });

      await expect(service.listWorkoutHistory(query(), COACH)).rejects.toThrow(NotFoundException);
    });

    it('summarises how much was in each workout and how much got done', async () => {
      await build(oneWorkout());

      const [workout] = (await service.listWorkoutHistory(query(), ATHLETE)).workouts;

      expect(workout).toMatchObject({
        id: WORKOUT,
        name: 'Squat day',
        date: '2026-09-10',
        exercise_count: 2,
        set_count: 3,
        completed_set_count: 2,
      });
    });

    /** The extra row is how `has_more` is answered, and it must not be served as
     * part of the page. */
    it('reads one row past the limit and reports it as another page', async () => {
      await build({
        workouts: [
          [
            { id: WORKOUT, name: 'Newer', date: '2026-09-10', notes: null },
            { id: 'older', name: 'Older', date: '2026-09-03', notes: null },
          ],
        ],
        workout_exercises: [[]],
      });

      const result = await service.listWorkoutHistory(query({ limit: 1 }), ATHLETE);

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].name).toBe('Newer');
      expect(result.has_more).toBe(true);
      expect(result.limit).toBe(1);
    });

    it('echoes the page window back, clamped', async () => {
      await build(oneWorkout());

      const result = await service.listWorkoutHistory(query({ limit: 5000, offset: 20 }), ATHLETE);

      expect(result).toMatchObject({ limit: MAX_HISTORY_LIMIT, offset: 20 });
    });

    it('returns an empty page rather than failing when there is no history', async () => {
      await build({ workouts: [[]] });

      const result = await service.listWorkoutHistory(query(), ATHLETE);

      expect(result).toEqual({ workouts: [], limit: 20, offset: 0, has_more: false });
    });
  });

  describe('listExerciseHistory', () => {
    const query = (overrides: Partial<HistoryQueryDto> = {}): HistoryQueryDto => ({
      athlete_id: ATHLETE,
      before: '2026-09-17',
      ...overrides,
    });

    const twoSessions = () => ({
      workouts: [
        [
          { id: WORKOUT, name: 'Squat day', date: '2026-09-10' },
          { id: 'older-workout', name: 'Squat day', date: '2026-09-03' },
        ],
      ],
      sets: [
        [
          { id: SET, workout_id: WORKOUT, set_number: 1, actual_load: 200, is_completed: true },
          { id: 's-2', workout_id: WORKOUT, set_number: 2, actual_load: 205, is_completed: true },
          {
            id: 's-3',
            workout_id: 'older-workout',
            set_number: 1,
            actual_load: 190,
            is_completed: true,
          },
        ],
      ],
    });

    it('groups an athlete’s sets under the session they were performed in', async () => {
      await build(twoSessions());

      const result = await service.listExerciseHistory(EXERCISE, query(), ATHLETE);

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0]).toMatchObject({
        workout_id: WORKOUT,
        workout_name: 'Squat day',
        date: '2026-09-10',
      });
      expect(result.sessions[0].sets).toHaveLength(2);
      expect(result.sessions[1].sets).toHaveLength(1);
      expect(result.has_more).toBe(false);
    });

    /** Again the gate only — see the note on the same case above. */
    it('lets an active coach past the gate on their athlete’s progression', async () => {
      await build({ coach_athlete_relationships: [[{ id: 'rel-1' }]], ...twoSessions() });

      await expect(service.listExerciseHistory(EXERCISE, query(), COACH)).resolves.toMatchObject({
        has_more: false,
      });
    });

    it('404s for a caller with no claim on the athlete', async () => {
      await build({ coach_athlete_relationships: [[]], ...twoSessions() });

      await expect(service.listExerciseHistory(EXERCISE, query(), STRANGER)).rejects.toThrow(
        NotFoundException,
      );
    });

    /** Pagination is over sessions, so the boundary row is a session and dropping
     * it must not drop half of the one before it. */
    it('pages over sessions and reports another page', async () => {
      await build(twoSessions());

      const result = await service.listExerciseHistory(EXERCISE, query({ limit: 1 }), ATHLETE);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].workout_id).toBe(WORKOUT);
      expect(result.sessions[0].sets).toHaveLength(2);
      expect(result.has_more).toBe(true);
    });

    /** An exercise the athlete has never trained — or one from another coach's
     * library — is an empty list, not a 404. The two are meant to be
     * indistinguishable. */
    it('returns no sessions for an exercise with no history', async () => {
      await build({ workouts: [[]], sets: [[{ id: SET }]] });

      const result = await service.listExerciseHistory(EXERCISE, query(), ATHLETE);

      expect(result).toEqual({ sessions: [], limit: 20, offset: 0, has_more: false });
    });

    it('tolerates a session whose sets came back empty', async () => {
      await build({
        workouts: [[{ id: WORKOUT, name: 'Squat day', date: '2026-09-10' }]],
        sets: [[]],
      });

      const result = await service.listExerciseHistory(EXERCISE, query(), ATHLETE);

      expect(result.sessions[0].sets).toEqual([]);
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
