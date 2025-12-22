import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import { validationExceptionFactory } from 'src/common/validation/pipes/exception-factory';
import { AthleteService } from 'src/users/service/athlete/athlete.service';
import { useContainer } from 'class-validator';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { Gender } from 'src/users/dto/create-user.dto';

/** Test cases:
 * npm run test:e2e athlete-create.e2e
 * --- Create Profile ---
 * - Successful with all fields -- line 119
 * - Successful with only required fields -- line 189
 * - Successful with a few optional fields -- line 232
 * - Fail due to missing required users field -- line 284
 * - Fail due to taken username -- line 304
 * - Fail due to invalid weight class -- 317
 * - Fail due to invalid federation -- 330
 * - Fail due to invalid division -- 343
 * - Fail due to invalid username (includes spaces) -- line 357
 */
describe('Athlete profile (POST) (e2e)', () => {
  let app: INestApplication<App>;
  let supabaseService: SupabaseService;
  let supabase: SupabaseClient;
  let athleteService: AthleteService;
  let dto;
  let profileLogin;
  let token;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    useContainer(app.select(AppModule), { fallbackOnErrors: true });

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        exceptionFactory: validationExceptionFactory,
      }),
    );

    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init(); // Start the NestJS app context

    profileLogin = {
      email: 'testingprofilecreate@gmail.com',
      password: 'test-create-101',
    };

    dto = {
      name: 'christian',
      username: 'chrrstian',
      gender: Gender.MALE,
      date_of_birth: '2005-11-22',
      federation: 'USAPL',
      weight_class: '67.5kg',
      division: 'Junior',
    };

    supabaseService = moduleFixture.get(SupabaseService);

    athleteService = moduleFixture.get(AthleteService);

    supabase = supabaseService.getClient();

    const login = await request(app.getHttpServer()).post('/auth/login').send(profileLogin);

    expect(login.status).toBe(200);
    expect(login.body.message).toBe('Login successful');

    token = login.body.access_token;
  });

  afterEach(async () => {
    // delete record of createProfile tests' row
    const createId = 'e5138b35-d40e-41e3-b238-c26b0c26757f';
    await supabase
      .from('users')
      .update({
        name: null,
        username: null,
        role: null,
        gender: null,
        date_of_birth: null,
      })
      .eq('id', createId);
    await supabase.from('athletes').delete().eq('user_id', createId);

    await app.close();
  });

  it('POST /athlete/profile successfully creates athletes record and updates user record with all possible fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Profile created successfully');

    const { data: user } = await supabase.auth.getUser(token);
    const id = user?.user?.id;

    const { data, error } = await supabase
      .from('athletes')
      .select(
        'federation_id,weight_class_id,division_id,users(name,username,gender,date_of_birth,role)',
      )
      .eq('user_id', id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const federation = await supabase
      .from('federations')
      .select('id')
      .eq('code', dto.federation)
      .single();

    const division = await supabase
      .from('divisions')
      .select('id')
      .eq('federation_id', federation.data?.id)
      .eq('name', dto.division)
      .single();

    const weight_class = await supabase
      .from('weight_classes')
      .select('id')
      .eq('federation_id', federation.data?.id)
      .eq('gender', dto.gender)
      .eq('name', dto.weight_class)
      .single();

    const expectedFed = federation.data?.id;
    const actualFed = data.federation_id;
    const expectedDiv = division.data?.id;
    const actualDiv = data.division_id;
    const expectedWeightClass = weight_class.data?.id;
    const actualWeightClass = data.weight_class_id;

    // check if expected federation id equals actual
    expect(expectedFed).toEqual(actualFed);
    expect(expectedDiv).toEqual(actualDiv);
    expect(expectedWeightClass).toEqual(actualWeightClass);

    // type cast again, checking users columns
    const users = data?.users as unknown as {
      name: string;
      username: string;
      role: string;
      gender: Gender;
      date_of_birth: string;
    };
    expect(users.name).toEqual(dto.name);
    expect(users.username).toEqual(dto.username);
    expect(users.role).toEqual('Athlete');
    expect(users.gender).toEqual(dto.gender);
    expect(users.date_of_birth).toEqual(dto.date_of_birth);
  });

  it('POST /athlete/profile successfully creates athletes record and updates user record with only required fields', async () => {
    dto = {
      name: 'christian',
      username: 'chrrstian',
      gender: Gender.FEMALE,
      date_of_birth: '1999-10-22',
    };

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Profile created successfully');

    const { data: user } = await supabase.auth.getUser(token);
    const id = user?.user?.id;

    const { data } = await supabase
      .from('athletes')
      .select('user_id,users(name,username,gender,role,date_of_birth)')
      .eq('user_id', id)
      .single();

    // 'athletes' record still created
    expect(data?.user_id).toEqual(id);

    // type cast again, checking users columns
    const users = data?.users as unknown as {
      name: string;
      username: string;
      role: string;
      gender: Gender;
      date_of_birth: string;
    };
    expect(users.name).toEqual(dto.name);
    expect(users.username).toEqual(dto.username);
    expect(users.role).toEqual('Athlete');
    expect(users.gender).toEqual(dto.gender);
    expect(users.date_of_birth).toEqual(dto.date_of_birth);
  });

  it('POST /athlete/profile successfully creates athletes record and updates user record with a few optional fields', async () => {
    dto = {
      name: 'christian',
      username: 'chrrstian',
      gender: Gender.MALE,
      date_of_birth: '2005-11-22',
      federation: 'IPF',
      division: 'Junior',
    };

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Profile created successfully');

    const { data: user } = await supabase.auth.getUser(token);
    const id = user?.user?.id;

    const { data } = await supabase
      .from('athletes')
      .select('user_id, division_id, federation_id, users(name,username,gender)')
      .eq('user_id', id)
      .single();

    const federation = await supabase
      .from('federations')
      .select('id')
      .eq('code', dto.federation)
      .single();

    const division = await supabase
      .from('divisions')
      .select('id')
      .eq('federation_id', federation.data?.id)
      .eq('name', dto.division)
      .single();

    const expectedFed = federation.data?.id;
    const actualFed = data?.federation_id;
    const expectedDiv = division.data?.id;
    const actualDiv = data?.division_id;

    // check if expected federation id equals actual
    expect(expectedFed).toEqual(actualFed);
    expect(expectedDiv).toEqual(actualDiv);
    expect(data?.user_id).toEqual(id);
  });

  it('POST /athlete/profile fails due to missing required users field (no name)', async () => {
    dto = {
      username: 'chrrstian',
      gender: Gender.GENDER_FLUID,
      date_of_birth: '2005-11-22',
      weight_class: '67.5kg',
      division: 'Junior',
    };

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    // can't predict exact message (failed validator varies), but checks to see if message is about the name.
    expect(res.body.message).toContain('name');
  });

  it('POST /athlete/profile fails due to taken username', async () => {
    dto.username = 'username_alr_taken';

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Username is already taken');
  });

  it('POST /athlete/profile fails due to non-existent weight class input', async () => {
    dto.weight_class = 'I am not real';

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('weight_class does not exist');
  });

  it('POST /athlete/profile fails due to non-existent division input', async () => {
    dto.division = 'I am not real';

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('division does not exist');
  });

  it('POST /athlete/profile fails due to non-existent federation input', async () => {
    dto.federation = 'I am not real';

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('federation does not exist');
  });

  it('POST /athlete/profile fails due to invalid username (includes spaces)', async () => {
    dto.username = "i can't be a username";

    const res = await request(app.getHttpServer())
      .post('/athlete/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(dto);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Username can only contain letters, numbers, underscores and periods',
    );
  });
});
