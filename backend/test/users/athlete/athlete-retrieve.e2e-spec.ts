import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import { useContainer } from 'class-validator';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_PROFILE_QUERY } from 'src/common/types/select.queries';
import {
  cleanupUsers,
  createAuthClient,
  createTestUser,
  e2eProfileMarkers,
  findReferenceData,
  requireLiveOptIn,
} from '../../helpers/fixtures';

/** GET /athlete/profile/:id
 *
 * Run with: npm run test:e2e -- athlete-retrieve
 *
 * ⚠️ Hits the real Supabase project named by SUPABASE_PROJECT_URL / SUPABASE_SECRET_KEY.
 * Requires E2E_ALLOW_LIVE=1. Creates one auth user plus a users/athletes row in
 * beforeAll and removes them in afterAll; the globalTeardown sweeper is the backstop
 * if this run dies before that. Reference data is looked up rather than hardcoded, so
 * the suite is portable across projects — but those tables must contain at least one
 * usable federation.
 *
 * ⚠️ **Two clients, deliberately.** `supabase` is the app's service-role client and
 * must never be signed in: supabase-js resolves the PostgREST Authorization header
 * as `session?.access_token ?? supabaseKey`, so the moment a session exists on a
 * client every query it makes runs as that *user* rather than as service_role.
 * Token minting happens on a throwaway client. That rule is now enforced centrally
 * by test/helpers/fixtures.ts — see the note there.
 */
describe('Athlete profile (GET) (e2e)', () => {
  let app: INestApplication<App>;
  let supabase: SupabaseClient;

  let athleteId: string;
  let token: string;

  /** Set the instant the auth user exists, before any step that can throw, so
   * afterAll can still tear it down if the fixture fails halfway. The previous
   * version only assigned athleteId on full success, so a fixture that failed
   * after createUser left an orphaned auth user behind on every run. */
  let createdUserId: string | null = null;

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror src/main.ts exactly, so assertions describe production behavior.
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
    const url = config.get<string>('SUPABASE_PROJECT_URL')!;
    const key = config.get<string>('SUPABASE_SECRET_KEY')!;

    // Separate instance, so signing in here cannot downgrade `supabase`.
    const authClient = createAuthClient(url, key);

    const fixture = await createAthleteFixture(supabase, authClient, (id) => {
      createdUserId = id;
    });
    athleteId = fixture.athleteId;
    token = fixture.token;
  });

  afterAll(async () => {
    // Keyed off createdUserId, not athleteId, so a fixture that threw partway still
    // cleans up. cleanupUsers walks the FK graph, so it stays correct as this spec
    // grows to touch more tables.
    if (createdUserId) {
      await cleanupUsers(supabase, [createdUserId]);
    }
    if (app) {
      await app.close();
    }
  });

  const get = (query: string) =>
    request(app.getHttpServer())
      .get(`/athlete/profile/${athleteId}${query}`)
      .set('Authorization', `Bearer ${token}`);

  describe('valid queries', () => {
    // [test name, the select string the endpoint should build, the ?data= param]
    const cases: Array<[string, string, string]> = [
      ['no query returns the public profile', PUBLIC_PROFILE_QUERY, ''],
      ['one nested field from users', 'users (username)', '?data=users.username'],
      ['one direct field from athletes', 'federation_id', '?data=federation_id'],
      ['a full-table request', 'federations (*)', '?data=federations'],
      [
        'direct, nested and full-table combined',
        'id, users (username), federations (*)',
        '?data=id,users.username,federations',
      ],
    ];

    test.each(cases)('%s', async (_name, expectedSelect, queryParam) => {
      const res = await get(queryParam);

      expect(res.status).toBe(200);

      // Compare against the same select issued directly, so the test asserts the
      // compiler produced an equivalent query rather than hardcoding fixture values.
      const expected = await supabase
        .from('athletes')
        .select(expectedSelect)
        .eq('id', athleteId)
        .single();

      if (expected.error) {
        throw new Error(
          `Reference query failed for '${expectedSelect}': ${expected.error.message}`,
        );
      }

      expect(res.body).toEqual(expected.data);
    });
  });

  describe('rejected queries', () => {
    const cases: Array<[string, string, string]> = [
      ['non-accessible athletes column', '?data=user_id', 'user_id'],
      ['non-allowlisted full table', '?data=users', 'users'],
      ['non-allowlisted nested column', '?data=users.id', 'users.id'],
      ['non-existent nested column', '?data=users.favorite_color', 'users.favorite_color'],
      ['mistyped table prefix', '?data=user.username', 'user.username'],
      ['nested column with no prefix', '?data=username', 'username'],
    ];

    test.each(cases)('%s is rejected', async (_name, queryParam, invalidQuery) => {
      const res = await get(queryParam);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Invalid query: '${invalidQuery}'`);
    });

    it('user_id stays inaccessible because it exposes auth.uid()', async () => {
      const res = await get('?data=user_id');
      expect(res.status).toBe(400);
    });
  });

  describe('missing athlete', () => {
    it('returns 404 when the id has no athletes row', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';

      const res = await request(app.getHttpServer())
        .get(`/athlete/profile/${unknownId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Athlete with ID ${unknownId} could not be found`);
    });
  });

  describe('authentication', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app.getHttpServer()).get(`/athlete/profile/${athleteId}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 with a malformed token', async () => {
      const res = await request(app.getHttpServer())
        .get(`/athlete/profile/${athleteId}`)
        .set('Authorization', 'Bearer not-a-real-token');

      expect(res.status).toBe(401);
    });
  });
});

/** Creates a confirmed auth user with a complete users row and an athletes row,
 * wired to real reference data so relational selects return actual values.
 */
async function createAthleteFixture(
  supabase: SupabaseClient,
  authClient: SupabaseClient,
  onUserCreated: (id: string) => void,
) {
  // Reference data is looked up, not hardcoded, so this is portable across projects.
  const reference = await findReferenceData(supabase);

  // createTestUser registers the id via onUserCreated the instant the auth user
  // exists — before anything that can throw — so a half-built fixture still tears
  // down. It also mints the token on the throwaway client, keeping `supabase` at
  // service_role.
  const { userId, username, token } = await createTestUser(supabase, authClient, onUserCreated);

  // Gender must match the weight class, or the app-level cross-validation would
  // reject this combination on the write path.
  const { error: userError } = await supabase
    .from('users')
    .update({
      ...e2eProfileMarkers(),
      username,
      gender: reference.gender,
      date_of_birth: '1995-06-15',
      is_athlete: true,
      is_coach: false,
    })
    .eq('id', userId);

  if (userError) {
    throw new Error(`Failed to populate users row: ${userError.message}`);
  }

  const { error: athleteError } = await supabase.from('athletes').insert({
    id: userId,
    federation_id: reference.federationId,
    division_id: reference.divisionId,
    weight_class_id: reference.weightClassId,
  });

  if (athleteError) {
    throw new Error(`Failed to create athletes row: ${athleteError.message}`);
  }

  return { athleteId: userId, token };
}
