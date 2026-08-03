import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import { useContainer } from 'class-validator';
import { SupabaseService } from 'src/supabase/supabase.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_PROFILE_QUERY } from 'src/common/types/select.queries';

/** GET /athlete/profile/:id
 *
 * Run with: npm run test:e2e -- athlete-retrieve
 *
 * ⚠️ Hits the real Supabase project named by SUPABASE_PROJECT_URL / SUPABASE_SECRET_KEY.
 * Creates one auth user plus a users/athletes row in beforeAll and removes them in
 * afterAll. Reference data (federations / divisions / weight_classes) is looked up
 * rather than hardcoded, so the suite is portable across projects — but those tables
 * must contain at least one usable federation.
 *
 * ⚠️ **Two clients, deliberately.** `supabase` is the app's service-role client and
 * must never be signed in: supabase-js resolves the PostgREST Authorization header
 * as `session?.access_token ?? supabaseKey`, so the moment a session exists on a
 * client every query it makes runs as that *user* rather than as service_role.
 * An earlier version of this fixture called signUp() on the shared client and then
 * inserted, which ran the insert as the brand-new user and failed with
 * "new row violates row-level security policy for table athletes". Sign-in happens
 * on `authClient`, a throwaway instance, purely to mint a token.
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
    const authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fixture = await createAthleteFixture(supabase, authClient, (id) => {
      createdUserId = id;
    });
    athleteId = fixture.athleteId;
    token = fixture.token;
  });

  afterAll(async () => {
    // Keyed off createdUserId, not athleteId, so a fixture that threw partway
    // still cleans up. Rows may not exist; deleting a missing row is a no-op.
    if (createdUserId) {
      await supabase.from('athletes').delete().eq('id', createdUserId);
      await supabase.from('users').delete().eq('id', createdUserId);
      await supabase.auth.admin.deleteUser(createdUserId);
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
  // Find a federation that has both a division and a weight class.
  const { data: division, error: divisionError } = await supabase
    .from('divisions')
    .select('id, federation_id')
    .limit(1)
    .single();

  if (divisionError || !division) {
    throw new Error(
      `No divisions found in the target Supabase project — seed reference data before running e2e: ${divisionError?.message ?? 'no rows'}`,
    );
  }

  const { data: weightClass, error: weightClassError } = await supabase
    .from('weight_classes')
    .select('id, gender')
    .eq('federation_id', division.federation_id)
    .limit(1)
    .single();

  if (weightClassError || !weightClass) {
    throw new Error(
      `No weight_classes found for federation ${division.federation_id} — seed reference data before running e2e: ${weightClassError?.message ?? 'no rows'}`,
    );
  }

  const email = `athlete-retrieve-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'TestPassword123!';

  // admin.createUser rather than signUp: it is an admin endpoint, so it leaves no
  // session on the client, and email_confirm removes the dependency on the
  // project having email confirmation switched off.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw new Error(`Failed to create test user: ${createError?.message ?? 'no user returned'}`);
  }

  const athleteId = created.user.id;

  // Register for teardown before anything else can throw.
  onUserCreated(athleteId);

  // Token comes from the throwaway client, so `supabase` stays service_role.
  const { data: auth, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !auth.session) {
    throw new Error(
      `Failed to sign in test user: ${signInError?.message ?? 'no session returned'}`,
    );
  }

  // Gender must match the weight class, or the app-level cross-validation would
  // reject this combination on the write path.
  const { error: userError } = await supabase
    .from('users')
    .update({
      first_name: 'Retrieve',
      last_name: 'Fixture',
      username: `retrieve_${Date.now().toString().slice(-9)}`,
      gender: weightClass.gender,
      date_of_birth: '1995-06-15',
      is_athlete: true,
      is_coach: false,
    })
    .eq('id', athleteId);

  if (userError) {
    throw new Error(`Failed to populate users row: ${userError.message}`);
  }

  const { error: athleteError } = await supabase.from('athletes').insert({
    id: athleteId,
    federation_id: division.federation_id,
    division_id: division.id,
    weight_class_id: weightClass.id,
  });

  if (athleteError) {
    throw new Error(`Failed to create athletes row: ${athleteError.message}`);
  }

  return { athleteId, token: auth.session.access_token };
}
