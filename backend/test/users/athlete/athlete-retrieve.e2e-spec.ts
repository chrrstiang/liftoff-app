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
  dataDb,
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
  let reference: {
    federationId: string;
    divisionId: string;
    weightClassId: string;
    gender: string;
  };

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
    reference = fixture.reference;
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
    /** The old version compared the response against the same select issued
     * directly to Supabase, which proved the compiler produced an equivalent
     * PostgREST string. There is no such string any more — the service builds a
     * Drizzle selection — so these assert on the response shape and values
     * instead. The compiler's own logic (dedupe, full-table collapse, allowlist
     * rejection) is covered exhaustively by athlete.service.spec.ts. */

    it('returns the public profile when no data param is given', async () => {
      const res = await get('');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', athleteId);
      expect(res.body.users).toMatchObject({ username: expect.any(String) });
      expect(res.body.federations).toMatchObject({ id: reference.federationId });
      expect(res.body.divisions).toMatchObject({ id: reference.divisionId });
      expect(res.body.weight_classes).toMatchObject({ id: reference.weightClassId });
      // Never exposed on a profile endpoint.
      expect(res.body.users).not.toHaveProperty('email');
    });

    it('returns one nested field from users', async () => {
      const res = await get('?data=users.username');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['users']);
      expect(Object.keys(res.body.users)).toEqual(['username']);
    });

    it('returns one direct field from athletes', async () => {
      const res = await get('?data=federation_id');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ federation_id: reference.federationId });
    });

    it('returns a full table', async () => {
      const res = await get('?data=federations');

      expect(res.status).toBe(200);
      expect(res.body.federations).toMatchObject({
        id: reference.federationId,
        code: expect.any(String),
      });
    });

    it('combines direct, nested and full-table requests', async () => {
      const res = await get('?data=id,users.username,federations');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', athleteId);
      expect(Object.keys(res.body.users)).toEqual(['username']);
      expect(res.body.federations).toHaveProperty('code');
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
  const reference = await findReferenceData();

  // Auth user still comes from Supabase -- that is where auth lives. The profile
  // rows go to Postgres, which is where data lives now.
  const { userId, username, token } = await createTestUser(supabase, authClient, onUserCreated);

  const db = dataDb();
  const markers = e2eProfileMarkers();

  // INSERT, not UPDATE. The Supabase trigger that created public.users at signup
  // does not exist here, so the row has to be created outright.
  await db.query(
    `insert into users (id, email, first_name, last_name, username, gender, date_of_birth, is_athlete, is_coach)
     values ($1, $2, $3, $4, $5, $6, $7, true, false)`,
    [
      userId,
      `${username}@example.com`,
      markers.first_name,
      markers.last_name,
      username,
      // Gender must match the weight class or the app-level cross-validation
      // would reject this combination on the write path.
      reference.gender,
      '1995-06-15',
    ],
  );

  await db.query(
    `insert into athletes (id, federation_id, division_id, weight_class_id)
     values ($1, $2, $3, $4)`,
    [userId, reference.federationId, reference.divisionId, reference.weightClassId],
  );

  return { athleteId: userId, token, reference };
}
