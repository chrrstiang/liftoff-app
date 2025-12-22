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
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';

/**
 * --- Update Profile ---
 * npm run test:e2e athlete-update.e2e
 * - Successful update of 'users' table column
 * - Successul update of federation
 * - Successul update of division
 * - Successful update of weight class
 * - Fail due to username already being taken
 * - Fail due to weight class not matching gender
 * - Fail due to weight class not matching federation
 * - Fail due to invalid division
 * - Fail due to division not matching federation
 * - Fail due to invalid federation
 */
describe('Athlete profile (PATCH) (e2e)', () => {
  let app: INestApplication<App>;
  let supabaseService: SupabaseService;
  let supabase: SupabaseClient;
  let profileLogin;
  let token;
  const successCases: Array<[string, UpdateAthleteDto]> = [
    [
      'Successful update of federation/weight_class',
      { federation: 'IPF', division: 'Junior', weight_class: '66kg' },
    ],
    [
      'Successful update of division',
      { federation: 'USAPL', division: 'Teen 3', weight_class: '67.5kg' },
    ],
    [
      'Successful update of weight_class',
      { federation: 'USAPL', division: 'Junior', weight_class: '75kg' },
    ],
    [
      'Successful update of division/weight_class',
      { federation: 'USAPL', division: 'Open', weight_class: '82.5kg' },
    ],
    [
      'Successful update of all athlete fields at once',
      { federation: 'IPF', division: 'Sub-Junior', weight_class: '83kg' },
    ],
  ];
  const failureCases: Array<[string, UpdateAthleteDto, string]> = [
    [
      'Fail due to weight class not matching gender',
      { federation: 'IPF', division: 'Junior', weight_class: '63kg' },
      `Failed to locate weight class '63kg' with 'Male' gender and given federation id`,
    ],
    [
      'Fail due to weight class not matching federation:',
      { federation: 'IPF', division: 'Junior', weight_class: '67.5kg' },
      `Failed to locate weight class '67.5kg' with 'Male' gender and given federation id`,
    ],
    [
      'Fail due to division not matching federation',
      { federation: 'USAPL', division: 'Sub-Junior', weight_class: '67.5kg' },
      `Failed to locate division 'Sub-Junior' with the given federation id`,
    ],
    [
      'Fail due to nonexistent federation',
      { federation: 'Im fake', division: 'Sub-Junior', weight_class: '67.5kg' },
      `federation does not exist`,
    ],
    [
      'Fail due to nonexistent division',
      { federation: 'IPF', division: 'Im fake', weight_class: '67.5kg' },
      `division does not exist`,
    ],
    [
      'Fail due to nonexistent weight class',
      { federation: 'IPF', division: 'Junior', weight_class: 'Im fake' },
      `weight_class does not exist`,
    ],
  ];
  const updateId = '05b2dd02-b33f-4f06-94a3-fb7ca8380852';

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
    const originalFedId = '6dd4a324-f5f0-4d62-a3e8-52aae276ea50';
    const originalDivId = 'a8da983e-3f7c-4070-affe-578b8f4db5fe';
    const originalWcId = 'e131fef7-3575-418e-bf64-eb48832d4c77';

    // reset athletes columns
    await supabase
      .from('athletes')
      .update({
        federation_id: originalFedId,
        division_id: originalDivId,
        weight_class_id: originalWcId,
      })
      .eq('user_id', updateId);
  });

  afterAll(async () => {
    await app.close();
  });

  test.each(successCases)(
    `%s`,
    async (testName: string, dto: UpdateAthleteDto) => {
      const res = await request(app.getHttpServer())
        .patch('/athlete/profile')
        .set(`Authorization`, `Bearer ${token}`)
        .send(dto);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Athlete profile updated successfully');

      const { data } = await supabase
        .from('athletes')
        .select('federations (code), divisions (name), weight_classes (name)')
        .eq('user_id', updateId)
        .single();

      const federations = data?.federations as unknown as {
        code: string;
      };

      const divisions = data?.divisions as unknown as {
        name: string;
      };

      const weight_classes = data?.weight_classes as unknown as {
        name: string;
      };

      expect(federations.code).toEqual(dto.federation);
      expect(divisions.name).toEqual(dto.division);
      expect(weight_classes.name).toEqual(dto.weight_class);
    },
  );

  test.each(failureCases)(
    `%s`,
    async (testName: string, dto: UpdateAthleteDto, errorMessage: string) => {
      const res = await request(app.getHttpServer())
        .patch('/athlete/profile')
        .set(`Authorization`, `Bearer ${token}`)
        .send(dto);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(errorMessage);
    },
  );
});
