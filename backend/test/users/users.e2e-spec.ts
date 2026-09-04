/**
 * POST /users/profile E2E tests
 * - Successfully create only a user profile
 * - Successfully create profile with all fields (athlete)
 * - Successfully create profile with all fields (coach)
 * - Successfully create profile with all fields (both)
 * - Fail due to missing required fields
 * - Fail due to long username
 * - Fail due to long biography
 * - Fail due to invalid date format
 * - Fail due to invalid gender
 * - Fail due to invalid federation_id / division_id / weight_class_id
 * - Fail when a dependent id is given without a federation
 *
 * ⚠️ Hits the real Supabase project named by SUPABASE_PROJECT_URL /
 * SUPABASE_SECRET_KEY. Requires E2E_ALLOW_LIVE=1; see test/helpers/fixtures.ts.
 *
 * Two things this spec used to get wrong, both fixed by the shared fixtures:
 *
 * 1. It called `supabase.auth.signUp()` on the SupabaseService singleton. Because
 *    supabase-js resolves the PostgREST header as
 *    `session?.access_token ?? supabaseKey`, that downgraded the shared client from
 *    service_role to the new user — so the app under test ran as `authenticated`,
 *    and the cleanup DELETEs silently affected zero rows (an RLS-blocked DELETE
 *    returns no error), leaking rows on every run.
 * 2. It hardcoded federation/division/weight-class UUIDs, pinning CI to specific
 *    production rows. Reference data is now looked up at runtime.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { Gender } from 'src/users/dto/create-user.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { Server } from 'http';
import { useContainer } from 'class-validator';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import {
  cleanupUsers,
  createAuthClient,
  createTestUser,
  e2eProfileMarkers,
  findReferenceData,
  requireLiveOptIn,
  type ReferenceData,
  type TestUser,
} from '../helpers/fixtures';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let supabase: SupabaseClient;
  let authClient: SupabaseClient;
  let reference: ReferenceData;

  /** ONE auth user for the whole suite.
   *
   * This is the single most effective thing for suite reliability. The original
   * created a user in `beforeEach` — ~13 Supabase signups per run — and auth is
   * the one dependency still on the shared project. Its rate limit is per-hour
   * and cumulative across CI runs, and when tripped it returns "Database error
   * creating new user", which reads like a broken trigger rather than throttling.
   *
   * Sharing is safe now for a reason worth knowing: `createUserProfile` upserts
   * (`onConflictDoUpdate` on users, `onConflictDoNothing` on athletes/coaches),
   * so a second POST for the same user succeeds rather than colliding on the
   * primary key. The four "success" cases are really asserting that the DTO
   * accepts each field combination, which holds regardless of whether the row
   * already existed.
   *
   * The validation-failure cases never write at all, so they cannot interfere. */
  let sharedUser: TestUser;

  /** Recorded the instant each auth user exists, so a fixture that throws partway
   * can still be torn down. */
  const createdUserIds: string[] = [];

  const freshUser = () => createTestUser(supabase, authClient, (id) => createdUserIds.push(id));

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror src/main.ts exactly, so these assertions describe production behavior.
    // useContainer is what makes the DB-backed async validators resolve their
    // dependencies; without it @IsUnique and @ValueExists silently pass.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();

    supabase = moduleFixture.get(SupabaseService).getClient();

    const config = moduleFixture.get(ConfigService);
    authClient = createAuthClient(
      config.get<string>('SUPABASE_PROJECT_URL')!,
      config.get<string>('SUPABASE_SECRET_KEY')!,
    );

    reference = await findReferenceData();
    sharedUser = await freshUser();
  });

  afterAll(async () => {
    await cleanupUsers(supabase, createdUserIds);
    await app.close();
  });

  describe('POST /users/profile', () => {
    /** Gender comes from the looked-up weight class, not a fixed value: the service
     * cross-validates weight_class against federation AND gender, so a hardcoded
     * gender would fail against whatever reference row this project happens to
     * have. */
    /** A distinct username per call, on purpose.
     *
     * The auth user is shared, but @IsUnique('users','username') checks the live
     * table — and once the first successful POST writes the shared username, every
     * later test reusing it fails uniqueness. Varying the username keeps the
     * validator honest while still costing only one signup: the upsert simply
     * renames the same row. */
    let usernameCounter = 0;
    const baseUserData = () => ({
      ...e2eProfileMarkers(),
      username: `${sharedUser.username}_${++usernameCounter}`,
      gender: reference.gender as Gender,
      date_of_birth: '1990-01-01',
      is_athlete: false,
      is_coach: false,
    });

    const athleteIds = () => ({
      federation_id: reference.federationId,
      division_id: reference.divisionId,
      weight_class_id: reference.weightClassId,
    });

    /** Defaults to the shared validation user; success cases pass their own. */
    const post = (as: TestUser = sharedUser) =>
      request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${as.token}`);

    it('should successfully create only a user profile', async () => {
      const response = await post().send(baseUserData()).expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should successfully create profile with all fields (athlete)', async () => {
      const response = await post()
        .send({ ...baseUserData(), is_athlete: true, ...athleteIds() })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should successfully create profile with all fields (coach)', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_coach: true,
          biography: 'Experienced coach',
          years_of_experience: 5,
        })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should successfully create profile with all fields (both)', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          is_coach: true,
          ...athleteIds(),
          biography: 'Experienced coach and athlete',
          years_of_experience: 5,
        })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should fail due to missing required fields', async () => {
      const response = await post().send({}).expect(400);

      expect(response.body.message).toContain('first_name should not be empty');
      expect(response.body.message).toContain('last_name should not be empty');
      expect(response.body.message).toContain('username should not be empty');
      expect(response.body.message).toContain(
        'gender must be one of the following values: Male, Female, Gender-fluid',
      );
      expect(response.body.message).toContain('date_of_birth must be a valid ISO 8601 date string');
      expect(response.body.message).toContain('is_athlete must be a boolean value');
      expect(response.body.message).toContain('is_coach must be a boolean value');
    });

    it('should fail due to long username', async () => {
      const response = await post()
        .send({ ...baseUserData(), username: 'a'.repeat(31) })
        .expect(400);

      expect(response.body.message).toContain(
        'username must be shorter than or equal to 30 characters',
      );
    });

    it('should fail due to long biography', async () => {
      const response = await post()
        .send({ ...baseUserData(), is_coach: true, biography: 'a'.repeat(501) })
        .expect(400);

      expect(response.body.message).toContain(
        'biography must be shorter than or equal to 500 characters',
      );
    });

    it('should fail due to invalid date format', async () => {
      const response = await post()
        .send({ ...baseUserData(), date_of_birth: 'not-a-date' })
        .expect(400);

      expect(response.body.message).toContain('date_of_birth must be a valid ISO 8601 date string');
    });

    it('should fail due to invalid gender', async () => {
      const response = await post()
        .send({ ...baseUserData(), gender: 'INVALID_GENDER' })
        .expect(400);

      expect(response.body.message).toContain(
        'gender must be one of the following values: Male, Female, Gender-fluid',
      );
    });

    it('should fail due to invalid federation_id when is_athlete is true', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          ...athleteIds(),
          federation_id: 'im fake',
        })
        .expect(400);

      expect(response.body.message).toContain('im fake');
    });

    it('should fail due to invalid division_id when is_athlete is true', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          ...athleteIds(),
          division_id: 'im fake',
        })
        .expect(400);

      expect(response.body.message).toContain('im fake');
    });

    it('should fail due to invalid weight_class_id when is_athlete is true', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          ...athleteIds(),
          weight_class_id: 'im fake',
        })
        .expect(400);

      expect(response.body.message).toContain('im fake');
    });

    it('should fail due to a division_id with no federation id', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          federation_id: null,
          division_id: reference.divisionId,
          weight_class_id: null,
        })
        .expect(400);

      expect(response.body.message).toContain('Federation is required to validate division');
    });

    it('should fail due to a weight_class_id with no federation id', async () => {
      const response = await post()
        .send({
          ...baseUserData(),
          is_athlete: true,
          federation_id: null,
          division_id: null,
          weight_class_id: reference.weightClassId,
        })
        .expect(400);

      expect(response.body.message).toContain('Federation is required to validate weight class');
    });
  });

  /** Three auth users for both describes below, created once.
   *
   * ⚠️ Not one per test, deliberately. The header of this file explains why: auth is
   * the only dependency still on the shared Supabase project, its signup limit is
   * per-hour and cumulative across CI runs, and when tripped it reports "Database
   * error creating new user" — which reads like a broken trigger, not throttling.
   * Creating a user per test is what made this suite flaky in the first place, and
   * the fix was to stop. Ten new signups here would have quietly undone it.
   *
   * - `newcomer` never gets a profile. That is the whole point of it.
   * - `profiled` is the happy-path subject.
   * - `other` is the second party for the isolation and uniqueness checks. */
  let newcomer: TestUser;
  let profiled: TestUser;
  let other: TestUser;

  /** Writes a complete profile for `user` and returns the username it used. */
  const createProfileFor = async (user: TestUser) => {
    await request(app.getHttpServer() as Server)
      .post('/users/profile')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        ...e2eProfileMarkers(),
        username: user.username,
        gender: reference.gender as Gender,
        date_of_birth: '1992-03-04',
        is_athlete: false,
        is_coach: false,
      })
      .expect(201);

    return user.username;
  };

  const me = (user: TestUser) =>
    request(app.getHttpServer() as Server)
      .get('/users/me')
      .set('Authorization', `Bearer ${user.token}`);

  /** ⚠️ The 404 below is **not** an error path — it is load-bearing product behaviour.
   *
   * Between signing up and completing the form there is no `users` row at all: the
   * Supabase trigger that used to create one does not exist in RDS. The frontend
   * auth gate reads this exact 404 as "route to create-profile". Nothing tested it
   * before, so a well-meaning change to a 200-with-null would have looked like a
   * cleanup and silently broken registration for every new user. */
  describe('GET /users/me', () => {
    beforeAll(async () => {
      newcomer = await freshUser();
      profiled = await freshUser();
      other = await freshUser();

      await createProfileFor(profiled);
      await createProfileFor(other);
    });

    it('404s for an authenticated user who has not completed the form', async () => {
      const res = await me(newcomer).expect(404);
      expect(res.body.message).toBe('No profile exists for this user yet');
    });

    it('returns the caller’s own row, including their email', async () => {
      const res = await me(profiled).expect(200);

      expect(res.body).toMatchObject({
        id: profiled.userId,
        username: profiled.username,
        email: profiled.email,
        is_athlete: false,
        is_coach: false,
        is_profile_complete: true,
      });
    });

    it('never returns another user’s row', async () => {
      // No id is accepted from the request, so the only way to reach someone else's
      // row would be the service dropping its eq(users.id, user.id) scope.
      const res = await me(other).expect(200);

      expect(res.body.id).toBe(other.userId);
      expect(res.body.id).not.toBe(profiled.userId);
      expect(res.body.email).not.toBe(profiled.email);
    });

    it('stays 404 after a PATCH, which must not conjure a row', async () => {
      // `update ... where id = $1` against a missing row affects nothing and does
      // not error, so this returns 200. What matters is that it did not create a
      // half-built profile and flip the auth gate's signal.
      await request(app.getHttpServer() as Server)
        .patch('/users/profile')
        .set('Authorization', `Bearer ${newcomer.token}`)
        .send({ avatar_url: 'avatars/newcomer.jpg' })
        .expect(200);

      await me(newcomer).expect(404);
    });

    it('reports an incomplete profile rather than throwing', async () => {
      // is_profile_complete is computed server-side precisely so that a transient
      // failure cannot masquerade as "incomplete" and bounce the user mid-session.
      // Runs last in this block: it nulls a column the assertions above read.
      await request(app.getHttpServer() as Server)
        .patch('/users/profile')
        .set('Authorization', `Bearer ${other.token}`)
        .send({ date_of_birth: null })
        .expect(200);

      const res = await me(other).expect(200);
      expect(res.body.is_profile_complete).toBe(false);
    });
  });

  describe('PATCH /users/profile', () => {
    const patch = (user: TestUser) =>
      request(app.getHttpServer() as Server)
        .patch('/users/profile')
        .set('Authorization', `Bearer ${user.token}`);

    it('updates the caller’s own row', async () => {
      const renamed = `${profiled.username.slice(0, 26)}_p`;

      await patch(profiled).send({ username: renamed, avatar_url: 'avatars/x/1.jpg' }).expect(200);

      const res = await me(profiled).expect(200);
      expect(res.body).toMatchObject({ username: renamed, avatar_url: 'avatars/x/1.jpg' });
    });

    it('touches only the caller, not every users row', async () => {
      // With no RLS, an unscoped `update users set ...` would succeed and rewrite
      // the whole table. This is the assertion that would catch it.
      await patch(profiled).send({ avatar_url: 'avatars/only-mine.jpg' }).expect(200);

      const res = await me(other).expect(200);

      expect(res.body.username).toBe(other.username);
      expect(res.body.avatar_url).not.toBe('avatars/only-mine.jpg');
    });

    /** The exact request `frontend/lib/api/storage.ts` sends after uploading an
     * avatar: that field and nothing else.
     *
     * This is a regression test. It returned **400** until the `name` field was
     * removed from `UpdateUserDto` — `PartialType` had not relaxed it, so every
     * PATCH omitting `name` failed. Avatar upload had been broken since it shipped,
     * and it failed *after* the image was already in the bucket. Nothing caught it
     * because this endpoint had no e2e coverage at all. */
    it('accepts an avatar-only patch, the shape the client actually sends', async () => {
      await patch(profiled).send({ avatar_url: 'avatars/solo/2.jpg' }).expect(200);

      const res = await me(profiled).expect(200);
      expect(res.body.avatar_url).toBe('avatars/solo/2.jpg');
    });

    it('accepts an empty patch as a no-op', async () => {
      const res = await patch(sharedUser).send({}).expect(200);
      expect(res.body.message).toBe('User profile updated successfully');
    });

    it('rejects an undeclared field rather than ignoring it', async () => {
      // forbidNonWhitelisted is what stops a client writing a column the DTO does
      // not name.
      const res = await patch(sharedUser).send({ role: 'admin' }).expect(400);
      expect(res.body.message).toContain('property role should not exist');
    });

    it('rejects a username already taken by someone else', async () => {
      const res = await patch(sharedUser).send({ username: other.username }).expect(400);
      expect(res.body.message).toContain('username must be unique');
    });

    /** Documents a rough edge rather than asserting desired behaviour.
     *
     * `@IsUnique('users','username')` matches **any** row, including the caller's
     * own, so re-sending your current username is rejected as a collision with
     * yourself. The client only ever sends changed fields, so nothing hits this
     * today — but a settings screen that PATCHes the whole form would. Fixing it
     * means excluding the caller's id from the uniqueness query, a change to the
     * validator's signature; out of scope here, recorded so the next person finds
     * it deliberately rather than as a surprise. */
    it('also rejects the caller’s own current username, a known rough edge', async () => {
      const res = await patch(other).send({ username: other.username }).expect(400);
      expect(res.body.message).toContain('username must be unique');
    });
  });

  describe('authentication', () => {
    const server = () => app.getHttpServer() as Server;

    it('401s on GET /users/me without a token', async () => {
      const res = await request(server()).get('/users/me').expect(401);
      expect(res.body.message).toBe('No token provided');
    });

    it('401s on GET /users/me with a malformed token', async () => {
      await request(server())
        .get('/users/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('401s on POST /users/profile without a token', async () => {
      // The id and email are taken from the verified token, so an unauthenticated
      // POST has no subject to write at all.
      await request(server()).post('/users/profile').send({}).expect(401);
    });

    it('401s on PATCH /users/profile without a token', async () => {
      await request(server()).patch('/users/profile').send({}).expect(401);
    });
  });
});
