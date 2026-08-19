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
});
