/**
 * Create user profile E2E tests
 * - Successfully create only a user profile
 * - Successfully create profile with all fields (athlete)
 * - Successfully create profile with all fields (coach)
 * - Successfully create profile with all fields (both)
 * - Fail due to missing required fields
 * - Fail due to long username
 * - Fail due to long biography
 * - Fail due to invalid date format
 * - Fail due to invalid gender
 * - Fail due to duplicate username
 * - Fail due to invalid federation_id
 * - Fail due to invalid division_id
 * - Fail due to invalid weight_class_id
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Gender } from '../../src/users/dto/create-user.dto';
import { SupabaseService } from '../../src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { Server } from 'http';
import { useContainer } from 'class-validator';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let supabaseService: SupabaseService;
  let supabase: SupabaseClient;
  let validToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Setup app ONCE
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    useContainer(app.select(AppModule), { fallbackOnErrors: true });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    supabaseService = moduleFixture.get<SupabaseService>(SupabaseService);
    supabase = supabaseService.getClient();
  });

  beforeEach(async () => {
    // new user per test
    const uniqueEmail = `test-${Date.now()}-${Math.random()}@gmail.com`;

    const { data: authData, error } = await supabase.auth.signUp({
      email: uniqueEmail,
      password: 'TestPassword123!',
    });

    if (error || !authData.user || !authData.session) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }

    testUserId = authData.user.id;
    validToken = authData.session.access_token;
  });

  afterEach(async () => {
    // clean up records and user from recent test
    if (!testUserId) return;

    try {
      const { error: athleteError } = await supabase.from('athletes').delete().eq('id', testUserId);
      if (athleteError) {
        console.log('Failed to delete athlete record:', athleteError);
      }
      console.log('Deleted athlete record');
      const { error: coachError } = await supabase.from('coaches').delete().eq('id', testUserId);
      if (coachError) {
        console.log('Failed to delete coach record:', coachError);
      }
      console.log('Deleted coach record');
      const { error: userError } = await supabase.from('users').delete().eq('id', testUserId);
      if (userError) {
        console.log('Failed to delete user record:', userError);
      }
      console.log('Deleted user record');

      await supabase.auth.admin.deleteUser(testUserId);
      console.log('Deleted user account');
    } catch (error) {
      console.error(`Cleanup failed for user ${testUserId}:`, error);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /users/profile', () => {
    const getBaseUserData = () => ({
      first_name: 'Test',
      last_name: 'User',
      username: `test_${Date.now().toString().slice(-8)}`,
      gender: Gender.MALE,
      date_of_birth: '1990-01-01',
      is_athlete: false,
      is_coach: false,
    });

    it('should successfully create only a user profile', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: `useronly_${Date.now()}`,
        })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should successfully create profile with all fields (athlete)', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: `athlete_${Date.now()}`,
          is_athlete: true,
          federation_id: '2339e288-bd79-4d91-b357-e5f5969a5223',
          division_id: '26dcbca5-07aa-48e5-b944-32f28036fa65',
          weight_class_id: '1fcc786f-9588-4d18-8bf0-a5564157c9b0',
        })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should successfully create profile with all fields (coach)', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: `coach_${Date.now()}`,
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
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: `both_${Date.now()}`,
          is_athlete: true,
          is_coach: true,
          federation_id: '2339e288-bd79-4d91-b357-e5f5969a5223',
          division_id: '26dcbca5-07aa-48e5-b944-32f28036fa65',
          weight_class_id: '1fcc786f-9588-4d18-8bf0-a5564157c9b0',
          biography: 'Experienced coach and athlete',
          years_of_experience: 5,
        })
        .expect(201);

      expect(response.body).toEqual({
        message: 'User profile created successfully!',
      });
    });

    it('should fail due to missing required fields', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({}) // Missing all required fields
        .expect(400);

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
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: 'a'.repeat(31), // 31 characters (max is 30)
        })
        .expect(400);

      expect(response.body.message).toContain(
        'username must be shorter than or equal to 30 characters',
      );
    });

    it('should fail due to long biography', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          is_coach: true,
          biography: 'a'.repeat(501), // 501 characters (max is 500)
        })
        .expect(400);

      expect(response.body.message).toContain(
        'biography must be shorter than or equal to 500 characters',
      );
    });

    it('should fail due to invalid date format', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          date_of_birth: 'not-a-date',
        })
        .expect(400);

      expect(response.body.message).toContain('date_of_birth must be a valid ISO 8601 date string');
    });

    it('should fail due to invalid gender', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          gender: 'INVALID_GENDER',
        })
        .expect(400);

      expect(response.body.message).toContain(
        'gender must be one of the following values: Male, Female, Gender-fluid',
      );
    });

    /*
    it('should fail due to duplicate username', async () => {
      const duplicateUsername = `duplicate_${Date.now()}`;

      // First request should succeed
      await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: duplicateUsername,
        })
        .expect(201);

      // Second request with same username should fail
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          username: duplicateUsername,
        })
        .expect(400);

      expect(response.body.message).toContain('Username already exists');
    });
    */
    it('should fail due to invalid federation_id when is_athlete is true', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          is_athlete: true,
          federation_id: 'im fake',
          division_id: '26dcbca5-07aa-48e5-b944-32f28036fa65',
          weight_class_id: '1fcc786f-9588-4d18-8bf0-a5564157c9b0',
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid federation_id');
    });

    it('should fail due to invalid division_id when is_athlete is true', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          is_athlete: true,
          federation_id: '2339e288-bd79-4d91-b357-e5f5969a5223',
          division_id: 'im fake',
          weight_class_id: '1fcc786f-9588-4d18-8bf0-a5564157c9b0',
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid division_id');
    });

    it('should fail due to invalid weight_class_id when is_athlete is true', async () => {
      const response = await request(app.getHttpServer() as Server)
        .post('/users/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          ...getBaseUserData(),
          is_athlete: true,
          federation_id: '2339e288-bd79-4d91-b357-e5f5969a5223',
          division_id: '26dcbca5-07aa-48e5-b944-32f28036fa65',
          weight_class_id: 'im fake',
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid weight_class_id');
    });
  });
});
