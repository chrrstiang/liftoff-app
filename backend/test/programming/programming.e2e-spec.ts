import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { Server } from 'http';
import { useContainer } from 'class-validator';
import { SupabaseClient } from '@supabase/supabase-js';
import { AppModule } from 'src/app.module';
import { SupabaseService } from 'src/supabase/supabase.service';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import {
  cleanupUsers,
  createAuthClient,
  createTestUser,
  dataDb,
  e2eProfileMarkers,
  findReferenceData,
  requireLiveOptIn,
  type TestUser,
} from '../helpers/fixtures';

/** Programming endpoints against **real Postgres**.
 *
 * Run with: npm run test:e2e -- programming
 *
 * ⚠️ Auth users come from the live Supabase project; all table rows go to the
 * Postgres named by DATABASE_URL. Requires E2E_ALLOW_LIVE=1.
 *
 * **Why this file matters more than the unit specs.** `workouts.service.spec.ts`
 * covers all 34 authorization rules against a mocked client, and a mock will
 * happily accept SQL that Postgres rejects. The previous Drizzle port shipped two
 * bugs that were invisible to mocked tests by construction:
 *
 *  - an `undefined` interpolated into a template `where`, producing
 *    `where "username" =  limit $1`
 *  - a malformed uuid surfacing as a 500 instead of a 400
 *
 * So the assertions here are deliberately split: the *rules* are proven cheaply in
 * the unit spec, and this file proves the queries execute, the joins produce the
 * shape the client expects, and the failure modes are the right status codes.
 */
describe('Programming (e2e)', () => {
  let app: INestApplication;
  let supabase: SupabaseClient;

  let coach: TestUser;
  let athlete: TestUser;
  /** A third user with no relationship to either, for the negative cases.
   *
   * Deliberately **both** an athlete and a coach. That covers the unrelated-athlete
   * cases (no relationship with `coach`) and the other-coach cases (an exercise
   * library of their own) with one auth user instead of two — and auth is the one
   * dependency still on the shared Supabase project, whose signup limit is per-hour
   * and cumulative across CI runs. */
  let stranger: TestUser;

  let exerciseId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror src/main.ts exactly, so these assertions describe production behaviour.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();

    supabase = moduleFixture.get(SupabaseService).getClient();

    const config = moduleFixture.get(ConfigService);
    const authClient = createAuthClient(
      config.get<string>('SUPABASE_PROJECT_URL')!,
      config.get<string>('SUPABASE_SECRET_KEY')!,
    );

    const track = (id: string) => createdUserIds.push(id);

    coach = await createTestUser(supabase, authClient, track);
    athlete = await createTestUser(supabase, authClient, track);
    stranger = await createTestUser(supabase, authClient, track);

    const reference = await findReferenceData();
    const db = dataDb();
    const markers = e2eProfileMarkers();

    // INSERT, not UPDATE: the Supabase trigger that created public.users at signup
    // does not exist in this database.
    for (const [user, isAthlete, isCoach] of [
      [coach, false, true],
      [athlete, true, false],
      [stranger, true, true],
    ] as Array<[TestUser, boolean, boolean]>) {
      await db.query(
        `insert into users (id, email, first_name, last_name, username, gender, date_of_birth,
                            is_athlete, is_coach)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.userId,
          user.email,
          markers.first_name,
          markers.last_name,
          user.username,
          reference.gender,
          '1995-06-15',
          isAthlete,
          isCoach,
        ],
      );
    }

    for (const user of [coach, stranger]) {
      await db.query('insert into coaches (id, biography) values ($1, $2)', [
        user.userId,
        'E2E coach',
      ]);
    }

    for (const user of [athlete, stranger]) {
      await db.query(
        `insert into athletes (id, federation_id, division_id, weight_class_id)
         values ($1, $2, $3, $4)`,
        [user.userId, reference.federationId, reference.divisionId, reference.weightClassId],
      );
    }

    await db.query(
      `insert into coach_athlete_relationships (athlete_id, coach_id, status)
       values ($1, $2, 'active')`,
      [athlete.userId, coach.userId],
    );
  });

  afterAll(async () => {
    await cleanupUsers(supabase, createdUserIds);
    if (app) await app.close();
  });

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: unknown) =>
      request(app.getHttpServer() as Server)
        .post(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body ?? {}),
    patch: (path: string, body?: unknown) =>
      request(app.getHttpServer() as Server)
        .patch(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body ?? {}),
    delete: (path: string) =>
      request(app.getHttpServer() as Server)
        .delete(path)
        .set('Authorization', `Bearer ${user.token}`),
  });

  /** Builds a workout for the athlete and returns its id plus its first set id. */
  async function createAssignedWorkout(name = 'E2E squat day') {
    const res = await as(coach)
      .post('/workouts', {
        name,
        date: '2026-08-20',
        athlete_id: athlete.userId,
        exercises: [
          {
            exercise_id: exerciseId,
            order: 0,
            display_name: 'Comp Squat',
            sets: [
              { set_number: 1, prescribed_reps: 5, prescribed_intensity: 'RPE 7' },
              { set_number: 2, prescribed_reps: 5, prescribed_intensity: 'RPE 8' },
            ],
          },
        ],
      })
      .expect(201);

    const detail = await as(athlete).get(`/workouts/${res.body.id}`).expect(200);

    return {
      workoutId: res.body.id as string,
      setId: detail.body.workout_exercises[0].sets[0].id as string,
    };
  }

  describe('POST /exercises', () => {
    it('creates a library exercise owned by the caller', async () => {
      const res = await as(coach).post('/exercises', { name: 'E2E Back Squat' }).expect(201);

      expect(res.body).toMatchObject({ id: expect.any(String), name: 'E2E Back Squat' });
      exerciseId = res.body.id;
    });

    it('rejects an empty name', async () => {
      const res = await as(coach).post('/exercises', { name: '' }).expect(400);
      expect(res.body.message).toContain('name should not be empty');
    });

    it('lists only the caller’s own library', async () => {
      const mine = await as(coach).get('/exercises').expect(200);
      expect(mine.body.map((e: { id: string }) => e.id)).toContain(exerciseId);

      const theirs = await as(stranger).get('/exercises').expect(200);
      expect(theirs.body.map((e: { id: string }) => e.id)).not.toContain(exerciseId);
    });
  });

  describe('POST /workouts', () => {
    it('creates a workout with its exercises and sets', async () => {
      const { workoutId } = await createAssignedWorkout();
      expect(workoutId).toEqual(expect.any(String));
    });

    /** The old client sent coach_id in the body. With forbidNonWhitelisted this is
     * now a 400 rather than a silently honoured spoof. */
    it('rejects a body that names its own coach_id', async () => {
      const res = await as(coach)
        .post('/workouts', {
          name: 'Spoofed',
          date: '2026-08-20',
          coach_id: stranger.userId,
          exercises: [{ exercise_id: exerciseId, order: 0, sets: [] }],
        })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toMatch(/coach_id/);
    });

    it('rejects an athlete who is not on the roster', async () => {
      const res = await as(coach)
        .post('/workouts', {
          name: 'Not mine',
          date: '2026-08-20',
          athlete_id: stranger.userId,
          exercises: [
            { exercise_id: exerciseId, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          ],
        })
        .expect(403);

      expect(res.body.message).toMatch(/not on your roster/);
    });

    it('rejects an athlete trying to program', async () => {
      await as(athlete)
        .post('/workouts', {
          name: 'Self-assigned',
          date: '2026-08-20',
          exercises: [
            { exercise_id: exerciseId, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          ],
        })
        .expect(403);
    });

    it('rejects an exercise from another coach’s library', async () => {
      const other = await as(stranger).post('/exercises', { name: 'E2E Theirs' }).expect(201);

      const res = await as(coach)
        .post('/workouts', {
          name: 'Borrowed',
          date: '2026-08-20',
          athlete_id: athlete.userId,
          exercises: [
            { exercise_id: other.body.id, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          ],
        })
        .expect(400);

      expect(res.body.message).toMatch(/Unknown exercise/);
    });

    /** A malformed uuid must be a 400 from the DTO, not a 500 from Postgres
     * rejecting the cast — the exact bug the last port shipped. */
    it('400s on a malformed athlete_id rather than 500ing', async () => {
      await as(coach)
        .post('/workouts', {
          name: 'Bad id',
          date: '2026-08-20',
          athlete_id: 'not-a-uuid',
          exercises: [
            { exercise_id: exerciseId, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] },
          ],
        })
        .expect(400);
    });
  });

  describe('templates', () => {
    it('creates a template when athlete_id is omitted, and lists it', async () => {
      const created = await as(coach)
        .post('/workouts', {
          name: 'E2E Template A',
          date: '2026-08-20',
          exercises: [
            {
              exercise_id: exerciseId,
              order: 0,
              sets: [{ set_number: 1, prescribed_reps: 3, prescribed_intensity: '80%' }],
            },
          ],
        })
        .expect(201);

      // The regression that made this list permanently empty for everyone.
      const list = await as(coach).get('/workouts/templates').expect(200);

      const template = list.body.find((t: { id: string }) => t.id === created.body.id);
      expect(template).toBeDefined();
      expect(template.workout_exercises[0].sets[0]).toMatchObject({
        set_number: 1,
        prescribed_reps: 3,
        prescribed_intensity: '80%',
      });
    });

    it('does not show one coach’s templates to another', async () => {
      const list = await as(stranger).get('/workouts/templates').expect(200);
      expect(list.body).toEqual([]);
    });

    /** `/workouts/templates` must not be parsed as `/workouts/:id`. */
    it('routes /workouts/templates ahead of /workouts/:id', async () => {
      const res = await as(coach).get('/workouts/templates');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /workouts', () => {
    it('lets the athlete list their own workouts', async () => {
      const res = await as(athlete).get(`/workouts?athlete_id=${athlete.userId}`).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    });

    it('lets their coach list them', async () => {
      const res = await as(coach).get(`/workouts?athlete_id=${athlete.userId}`).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('404s for an unrelated user', async () => {
      await as(stranger).get(`/workouts?athlete_id=${athlete.userId}`).expect(404);
    });

    it('400s when athlete_id is missing rather than listing everything', async () => {
      const res = await as(coach).get('/workouts').expect(400);
      expect(res.body.message).toMatch(/athlete_id is required/);
    });

    it('400s on a malformed athlete_id', async () => {
      await as(coach).get('/workouts?athlete_id=nope').expect(400);
    });

    it('excludes templates, which belong to no athlete', async () => {
      const res = await as(coach).get(`/workouts?athlete_id=${athlete.userId}`).expect(200);
      expect(res.body.map((w: { name: string }) => w.name)).not.toContain('E2E Template A');
    });
  });

  describe('GET /workouts/:id', () => {
    it('returns exercises and sets nested and ordered', async () => {
      const { workoutId } = await createAssignedWorkout('E2E ordering');

      const res = await as(athlete).get(`/workouts/${workoutId}`).expect(200);

      expect(res.body).toMatchObject({ id: workoutId, athlete_id: athlete.userId });
      expect(res.body.workout_exercises).toHaveLength(1);

      const exercise = res.body.workout_exercises[0];
      // display_name wins over the library name when present.
      expect(exercise.name).toBe('Comp Squat');
      expect(exercise.exercise).toMatchObject({ id: exerciseId, name: 'E2E Back Squat' });
      expect(exercise.sets.map((s: { set_number: number }) => s.set_number)).toEqual([1, 2]);
    });

    it('lets the coach read it too', async () => {
      const { workoutId } = await createAssignedWorkout('E2E coach read');
      await as(coach).get(`/workouts/${workoutId}`).expect(200);
    });

    it('404s for an unrelated user', async () => {
      const { workoutId } = await createAssignedWorkout('E2E stranger read');
      await as(stranger).get(`/workouts/${workoutId}`).expect(404);
    });

    it('404s for a well-formed but unknown id', async () => {
      await as(coach).get('/workouts/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('400s on a malformed id rather than 500ing', async () => {
      await as(coach).get('/workouts/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /sets/:id', () => {
    it('lets the athlete log the set', async () => {
      const { setId } = await createAssignedWorkout('E2E logging');

      const res = await as(athlete)
        .patch(`/sets/${setId}`, { actual_load: 142.5, actual_intensity: 8, is_completed: true })
        .expect(200);

      expect(res.body).toMatchObject({
        id: setId,
        actual_load: 142.5,
        actual_intensity: 8,
        is_completed: true,
      });
    });

    it('forbids the coach from logging it', async () => {
      const { setId } = await createAssignedWorkout('E2E coach log');
      await as(coach).patch(`/sets/${setId}`, { actual_load: 200 }).expect(403);
    });

    it('404s for an unrelated user', async () => {
      const { setId } = await createAssignedWorkout('E2E stranger log');
      await as(stranger).patch(`/sets/${setId}`, { actual_load: 200 }).expect(404);
    });

    it('rejects an empty patch', async () => {
      const { setId } = await createAssignedWorkout('E2E empty patch');
      await as(athlete).patch(`/sets/${setId}`, {}).expect(400);
    });

    it('rejects an attempt to rewrite the prescription', async () => {
      const { setId } = await createAssignedWorkout('E2E prescription');

      const res = await as(athlete).patch(`/sets/${setId}`, { prescribed_reps: 1 }).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/prescribed_reps/);
    });

    /** null clears the value; it must not be rejected as "not a number". */
    it('accepts an explicit null to clear a logged value', async () => {
      const { setId } = await createAssignedWorkout('E2E clear');

      await as(athlete).patch(`/sets/${setId}`, { actual_load: 100 }).expect(200);
      const res = await as(athlete).patch(`/sets/${setId}`, { actual_load: null }).expect(200);

      expect(res.body.actual_load).toBeNull();
    });
  });

  describe('POST /workouts/:id/exercises', () => {
    it('adds an existing library exercise and appends its order', async () => {
      const { workoutId } = await createAssignedWorkout('E2E add existing');

      const res = await as(coach)
        .post(`/workouts/${workoutId}/exercises`, {
          exercise_id: exerciseId,
          sets: [{ set_number: 1, prescribed_reps: 8 }],
        })
        .expect(201);

      // The seed workout occupies order 0.
      expect(res.body).toMatchObject({ exercise_id: exerciseId, order: 1 });
    });

    it('creates a new library exercise when given a name', async () => {
      const { workoutId } = await createAssignedWorkout('E2E add new');

      const res = await as(coach)
        .post(`/workouts/${workoutId}/exercises`, {
          name: 'E2E Paused Bench',
          sets: [{ set_number: 1, prescribed_reps: 5 }],
        })
        .expect(201);

      expect(res.body.exercise_id).toEqual(expect.any(String));

      const detail = await as(coach).get(`/workouts/${workoutId}`).expect(200);
      expect(
        detail.body.workout_exercises.map((e: { exercise: { name: string } }) => e.exercise.name),
      ).toContain('E2E Paused Bench');
    });

    it('rejects both exercise_id and name', async () => {
      const { workoutId } = await createAssignedWorkout('E2E both');

      await as(coach)
        .post(`/workouts/${workoutId}/exercises`, {
          exercise_id: exerciseId,
          name: 'Either or',
          sets: [{ set_number: 1, prescribed_reps: 5 }],
        })
        .expect(400);
    });

    it('forbids the athlete from changing the structure', async () => {
      const { workoutId } = await createAssignedWorkout('E2E athlete structure');

      await as(athlete)
        .post(`/workouts/${workoutId}/exercises`, {
          exercise_id: exerciseId,
          sets: [{ set_number: 1, prescribed_reps: 5 }],
        })
        .expect(403);
    });

    it('404s for an unrelated user', async () => {
      const { workoutId } = await createAssignedWorkout('E2E stranger structure');

      await as(stranger)
        .post(`/workouts/${workoutId}/exercises`, {
          exercise_id: exerciseId,
          sets: [{ set_number: 1, prescribed_reps: 5 }],
        })
        .expect(404);
    });
  });

  describe('DELETE /workouts/:id', () => {
    it('forbids the athlete', async () => {
      const { workoutId } = await createAssignedWorkout('E2E athlete delete');
      await as(athlete).delete(`/workouts/${workoutId}`).expect(403);
    });

    /** The foreign keys have no cascade, so this proves the child deletes happen
     * in the right order — a wrong order fails on the constraint, not silently. */
    it('deletes the workout and its children for the coach', async () => {
      const { workoutId } = await createAssignedWorkout('E2E coach delete');

      await as(coach).delete(`/workouts/${workoutId}`).expect(200);
      await as(coach).get(`/workouts/${workoutId}`).expect(404);
    });
  });

  describe('GET /athlete/search', () => {
    it('finds an athlete by username', async () => {
      const res = await as(coach).get(`/athlete/search?q=${stranger.username}`).expect(200);

      expect(res.body.map((a: { athlete_id: string }) => a.athlete_id)).toContain(stranger.userId);
    });

    /** The filter the client version never actually applied: it compared against
     * `user.id`, but the view's identity column is `athlete_id`, so it excluded
     * nobody and already-signed athletes kept appearing in search. */
    it('excludes athletes already on the caller’s roster', async () => {
      const res = await as(coach).get(`/athlete/search?q=${athlete.username}`).expect(200);

      expect(res.body.map((a: { athlete_id: string }) => a.athlete_id)).not.toContain(
        athlete.userId,
      );
    });

    it('never returns the caller', async () => {
      const res = await as(coach).get(`/athlete/search?q=${coach.username}`).expect(200);
      expect(res.body.map((a: { athlete_id: string }) => a.athlete_id)).not.toContain(coach.userId);
    });

    it('returns nothing for an empty query rather than every athlete', async () => {
      const res = await as(coach).get('/athlete/search?q=').expect(200);
      expect(res.body).toEqual([]);
    });

    /** An unescaped `%` would match every athlete in the database, turning search
     * into an unbounded listing endpoint. */
    it('treats % as a literal, not a wildcard', async () => {
      const res = await as(coach).get('/athlete/search?q=%25').expect(200);
      expect(res.body).toEqual([]);
    });

    /** A term with a PostgREST reserved character used to change the meaning of the
     * `.or()` filter it was interpolated into. Parameterised now, so it is inert. */
    it('treats a comma as a literal', async () => {
      const res = await as(coach).get('/athlete/search?q=a,b').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('authentication', () => {
    it('401s without a token', async () => {
      await request(app.getHttpServer() as Server)
        .get('/workouts/templates')
        .expect(401);
    });

    it('401s with a malformed token', async () => {
      await request(app.getHttpServer() as Server)
        .get('/workouts/templates')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });
});
