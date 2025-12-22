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
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

/**
 * --- Update Profile ---
 * npm run test:e2e users.e2e
 * - Successfully update name of user
 * - Successfully update username of user
 * - Successfully update name and username of user
 * - Fail due to username with spaces
 * - Fail due to username with uppercase
 * - Fail due to username being taken
 * - Fail due to username being too long
 */
describe('User Profile (PATCH) (e2e)', () => {
  let app: INestApplication<App>;
  let supabaseService: SupabaseService;
  let supabase: SupabaseClient;
  let profileLogin;
  let token;
  const updateId = '05b2dd02-b33f-4f06-94a3-fb7ca8380852';
  const successCases: Array<[string, UpdateUserDto]> = [
    ['Successfully update name of user', { name: 'Daniel' }],
    ['Successfully update username of user', { username: 'chrrstian.pl' }],
    [
      'Successfully update name and username of user',
      { name: 'Daniel', username: 'chrrstian.pl' },
    ],
  ];
  const failureCases: Array<[string, UpdateUserDto, string]> = [
    [
      'Fail due to username with spaces',
      { username: 'i contain spaces' },
      'Username can only contain letters, numbers, underscores and periods',
    ],
    [
      'Fail due to username with uppercase',
      { username: 'I_have_Uppercases' },
      'Username must be lowercase',
    ],
    [
      'Fail due to username being taken',
      { username: 'username_alr_taken' },
      'Username is already taken',
    ],
    [
      'Fail due to username being too long',
      { username: 'iamwaytoolongforthisapplication' },
      'Username must be between 3 and 20 characters',
    ],
  ];

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
      email: 'test-profile-update@gmail.com',
      password: 'test-update-101',
    };

    supabaseService = moduleFixture.get(SupabaseService);

    supabase = supabaseService.getClient();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send(profileLogin);

    expect(login.status).toBe(200);
    expect(login.body.message).toBe('Login successful');

    token = login.body.access_token;
  });

  afterEach(async () => {
    // delete record of updateProfile tests' row
    const originalName = 'Christian';
    const originalUsername = 'cg_update_test_acc';

    // reset user columns
    await supabase
      .from('users')
      .update({
        name: originalName,
        username: originalUsername,
      })
      .eq('id', updateId);
  });

  afterAll(async () => {
    await app.close();
  });

  test(`Successfully update name of user`, async () => {
    const res = await request(app.getHttpServer())
      .patch('/user/profile')
      .set(`Authorization`, `Bearer ${token}`)
      .send({ name: 'Daniel' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User profile updated successfully');

    const { data } = await supabase
      .from('users')
      .select('name')
      .eq('id', updateId)
      .single();

    expect(data?.name).toEqual('Daniel');
  });

  test(`Successfully update username of user`, async () => {
    const res = await request(app.getHttpServer())
      .patch('/user/profile')
      .set(`Authorization`, `Bearer ${token}`)
      .send({ username: 'chrrstian.pl' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User profile updated successfully');

    const { data } = await supabase
      .from('users')
      .select('username')
      .eq('id', updateId)
      .single();

    expect(data?.username).toEqual('chrrstian.pl');
  });

  test(`Successfully update name and username of user`, async () => {
    const res = await request(app.getHttpServer())
      .patch('/user/profile')
      .set(`Authorization`, `Bearer ${token}`)
      .send({ name: 'Daniel', username: 'chrrstian.pl' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User profile updated successfully');

    const { data } = await supabase
      .from('users')
      .select('name, username')
      .eq('id', updateId)
      .single();

    expect(data?.name).toEqual('Daniel');
    expect(data?.username).toEqual('chrrstian.pl');
  });

  test.each(failureCases)(
    `%s`,
    async (testName: string, dto: UpdateUserDto, errorMessage: string) => {
      const res = await request(app.getHttpServer())
        .patch('/user/profile')
        .set(`Authorization`, `Bearer ${token}`)
        .send(dto);

      console.log(res.body);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(errorMessage);
    },
  );
});
