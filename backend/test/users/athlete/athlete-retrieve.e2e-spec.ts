import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import { validationExceptionFactory } from 'src/common/validation/pipes/exception-factory';
import { useContainer } from 'class-validator';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_PROFILE_QUERY } from 'src/common/types/select.queries';

/** Test cases:
 * npm run test:e2e athlete-retrieve.e2e
 * --- Retrieve Profile ---
 * - Successful with no query (retrieve all fields)
 * - Successful with one field from 'users'
 * - Successul with one field from 'athletes'
 * - Successul with a table request
 * - Successful with table, nested, and direct query
 * - Fail due to non-accessible direct field (user_id)
 * - Fail due to user not being found
 */
describe('Athlete profile (GET) (e2e)', () => {
  let app: INestApplication<App>;
  let supabaseService: SupabaseService;
  let supabase: SupabaseClient;
  let profileLogin;
  let token;
  let athleteId: string = '7e1cda5f-d425-426a-8cb1-8ea31a453894';
  let successTests: Array<[string, string, string,]> = [
    [`Successful with no query (retrieve all fields)`, PUBLIC_PROFILE_QUERY, ""],
    [`Successful with one field from 'users' table`, 'users (name)', '?data=users.name'],
    [`Successul with one field from 'athletes'`, 'federation_id', '?data=federation_id'],
    [`Successul with a table request`, 'federations (*)', '?data=federations'],
    [`Successful with table, nested, and direct query`, 'id, users (name), federations (*)', '?data=id,users.name,federations'],
  ]
  let failureFromQueryTests: Array<[string, string, string]> = [
    [`Fail due to non-accessible direct (athletes) column`, '?data=user_id', 'user_id'],
    [`Fail due to non-accessible full table query`, '?data=users', 'users'],
    [`Fail due to non-accessible nested column query`, '?data=users.id', 'users.id'],
    [`Fail due to non-existent column`, '?data=users.favorite_toilet_paper', 'users.favorite_toilet_paper'],
    [`Fail due to non-existent column`, '?data=users.favorite_toilet_paper', 'users.favorite_toilet_paper'],
    [`Fail due to mistyped field prefix`, '?data=user.name', 'user.name'],
    [`Fail due to missing prefix`, '?data=username', 'username']
  ]

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
  
      app = moduleFixture.createNestApplication();

      useContainer(app.select(AppModule), { fallbackOnErrors: true });
  
      app.useGlobalPipes(new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        exceptionFactory: validationExceptionFactory
      }));

      app.useGlobalFilters(new GlobalExceptionFilter());
  
      await app.init(); // Start the NestJS app context


      profileLogin = {
        email: 'testingprofilecreate@gmail.com',
        password: 'test-create-101'
      }

      supabaseService = moduleFixture.get(SupabaseService);

      supabase = supabaseService.getClient()

    const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send(profileLogin)

    expect(login.status).toBe(200);
    expect(login.body.message).toBe('Login successful');

    token = login.body.access_token;
  });

  afterEach(async () => {
    await app.close();
  })

  test.each(successTests)('%s',
    async (testName: string, correctQuery: string, requestQuery: string) => {
    const res = await request(app.getHttpServer())
    .get(`/athlete/profile/${athleteId}${requestQuery}`)
    .set(`Authorization`, `Bearer ${token}`)

    expect(res.status).toBe(200);

    const correctData = await supabase
    .from('athletes')
    .select(correctQuery)
    .eq('id', athleteId)
    .single();

    if (correctData.error) {
        throw new Error('Query failed')
    }

    expect(res.body).toEqual(correctData.data)
  })

  test.each(failureFromQueryTests)('%s', async (testName: string, query: string, invalidQuery: string) => {
    const res = await request(app.getHttpServer())
    .get(`/athlete/profile/${athleteId}${query}`)
    .set(`Authorization`, `Bearer ${token}`)

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Invalid query: '${invalidQuery}'`);
  })

  it('athlete ID does not correspond to an athlete record in table', async () => {
    const query = '?data=users.name'
    const athleteId = '123'
    const res = await request(app.getHttpServer())
    .get(`/athlete/profile/${athleteId}${query}`)
    .set(`Authorization`, `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.message).toBe(`Athlete with ID ${athleteId} could not be found`);
  })
});
