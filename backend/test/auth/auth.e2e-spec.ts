import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';

/** End-To-End Integration Tests for Authentication Module. This test file
 * ensures endpoints successfully complete operations and logic works accordingly,
 * from the DTO's decorators, the logic within the service methods, and the database's
 * row level security and policies. Status code, return messages/errors, and content
 * of the database are checked.
 *
 * Authentication operations include
 * - Signing up a user
 * - Logging in a user
 * - Logging out a user
 * - Updating a user
 *
 * Notable Edge Cases:
 * - Signing up with a missing email and/or password
 * - Logging in with incorrect/nonexistent credentials
 * - Updating user with existing email
 * - Updating user without logging in
 * - Updating user with same password/email
 * - Updating user with empty DTO
 *
 */

describe('Auth E2E Tests', () => {
  let app: INestApplication;
  let supabase: SupabaseClient;
  let supabaseService: SupabaseService;

  const testValidEmail = 'christiantestemail@gmail.com';
  const testValidPassword = 'ExamplePassword101';
  const loginEmail = 'testinglogin@gmail.com';
  const loginPassword = 'logintest101';
  const updateTestID = '97bdb582-4d7a-4999-b55a-af4c15ef615f';
  const updateTestEmail = 'garcia.chris@northeastern.edu';
  const updateTestPassword = 'fakepassword101';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init(); // Start the NestJS app context

    supabaseService = moduleFixture.get(SupabaseService);
    supabase = supabaseService.getClient();
  });

  afterEach(async () => {
    const supabase = supabaseService.getClient();

    // delete user from auth
    const { data } = await supabase.auth.admin.listUsers();
    const users = data.users as { id: string; email?: string }[];
    const user = users.find((u) => u.email === testValidEmail);

    if (user) {
      await supabase.auth.admin.deleteUser(user.id);
    }

    // delete record from users table
    await supabase.from('users').delete().eq('email', testValidEmail);

    await supabase.auth.admin.updateUserById(updateTestID, {
      email: updateTestEmail,
      password: updateTestPassword,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // Successful signup E2E test with a valid email and password.
  it('/auth/signup (POST) should return 201 for valid signup', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: testValidEmail, password: testValidPassword });

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', testValidEmail)
      .single();

    // ensure user exists in table
    expect(user).toBeDefined();
    expect(user.id).toBeDefined();

    const { data } = await supabase.auth.admin.getUserById(user.id);

    // check if user exists in auth
    expect(data.user).toBeDefined();

    // check if user exists in 'users' table
    expect(user).toBeDefined();

    // check if auth user's email matches the given email
    expect(data?.user?.email).toBe(testValidEmail);

    // check if 'users' record's email matches the given email
    expect(user.email).toBe(testValidEmail);

    // checks if the request's status is as expected
    expect(res.status).toBe(201);

    // checks if they request's body is as expected
    expect(res.body).toEqual({ message: 'User created successfully' });
  });

  it('/auth/signup (POST) should return status 400 for empty body', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'email must be an email',
      'email should not be empty',
      'password must be at least 6 characters long',
      'password must be a string',
      'password should not be empty',
    ]);
  });

  it('/auth/signup (POST) should return status 400 for missing email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ password: 'DecoyPassword' });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'email must be an email',
      'email should not be empty',
    ]);
  });

  it('/auth/signup (POST) should return status 400 for missing password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'iwillfail@gmail.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'password must be at least 6 characters long',
      'password must be a string',
      'password should not be empty',
    ]);
  });

  it('/auth/signup (POST) should return status 400 for an invalid email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'fakeemail.com', password: 'DecoyPassword' });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(['email must be an email']);
  });

  it('/auth/signup (POST) should return status 400 for an invalid password type', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'iwillfail@gmail.com', password: 1234 });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'password must be at least 6 characters long',
    ]);
  });

  // Successful login E2E test with a valid email/password
  it('/auth/login (POST) should return 200 for a valid login', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: loginEmail, password: loginPassword });

    // check response status
    expect(res.status).toBe(200);

    // check response (login was successful if this was returned)
    expect(res.body.message).toEqual('Login successful');
  });

  it('/auth/login (POST) should return 400 for a nonexistent email', async () => {
    const email = 'anotherfake@gmail.com';

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email, password: loginPassword });

    // check response status
    expect(res.status).toBe(400);

    // check response (login was successful if this was returned)
    expect(res.body.message).toEqual(
      'Failed to login user: Invalid login credentials',
    );
  });

  it('/auth/login (POST) should return 400 for incorrect password', async () => {
    const password = 'logintest202';

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: loginEmail, password: password });

    // check response status
    expect(res.status).toBe(400);

    // check response (login was successful if this was returned)
    expect(res.body.message).toEqual(
      'Failed to login user: Invalid login credentials',
    );
  });

  // Successful logout E2E test with a valid email/password
  it('/auth/logout (POST) should return 200 for a valid logout', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout').send();

    // check response status
    expect(res.status).toBe(200);

    // check response (login was successful if this was returned)
    expect(res.body).toEqual({ message: 'Logout successful' });
  });

  it('/auth/update (PATCH) should return 200 for a valid email change', async () => {
    // user must be logged in before any updates can happen
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ email: 'kikifrog1122@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User updated successfully');

    const { data: user } = await supabase.auth.admin.getUserById(updateTestID);

    // check if new email reaches user; email is not fully switched until confirmation
    expect(user.user?.new_email).toBe('kikifrog1122@gmail.com');
  });

  it('/auth/update (PATCH) should return 200 for same email change', async () => {
    // user must be logged in before any updates can happen
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ email: updateTestEmail });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User updated successfully');

    const { data: user } = await supabase.auth.admin.getUserById(updateTestID);

    // check if new email reaches user; email is not fully switched until confirmation
    expect(user.user?.email).toBe(updateTestEmail);
  });

  it('/auth/update (PATCH) should return 200 for a valid password change', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ password: 'brandnewpassword' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User updated successfully');
  });

  it('/auth/update (PATCH) should return 400 for same password change', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ password: updateTestPassword });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Could not update user: New password should be different from the old password.',
    );
  });

  it('/auth/update should return 400 for user not being logged in', async () => {
    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ email: 'hellolady@gmail.com', password: "Don'tmatterimafail" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Could not update user: Auth session missing!',
    );
  });

  it('/auth/update (PATCH) should return 400 for a invalid test email domain', async () => {
    // user must be logged in before any updates can happen
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ email: 'somerandomemail@email.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Could not update user: Email address "garcia.chris@northeastern.edu" is invalid',
    );
  });

  it('/auth/update (PATCH) should return 400 for a existing email change', async () => {
    // user must be logged in before any updates can happen
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: updateTestEmail, password: updateTestPassword });

    expect(loginResponse.body.message).toBe('Login successful');

    const res = await request(app.getHttpServer())
      .patch('/auth/update')
      .send({ email: 'testinglogin@gmail.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Could not update user: A user with this email address has already been registered',
    );
  });
});
