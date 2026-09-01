import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { Server } from 'http';
import { useContainer } from 'class-validator';
import { SupabaseClient } from '@supabase/supabase-js';
import { AppModule } from 'src/app.module';
import { SupabaseService } from 'src/supabase/supabase.service';
import { GlobalExceptionFilter } from 'src/common/filters/global-exception-filter';
import {
  cleanupUsers,
  closeDataDb,
  createAuthClient,
  createTestUser,
  dataDb,
  e2eProfileMarkers,
  findReferenceData,
  requireLiveOptIn,
  type TestUser,
} from '../helpers/fixtures';

/** Coach invites and messaging against **real Postgres**.
 *
 * Run with: npm run test:e2e -- coaching
 *
 * ⚠️ Auth users come from the live Supabase project; all table rows go to the
 * Postgres named by DATABASE_URL. Requires E2E_ALLOW_LIVE=1.
 *
 * **Why this file exists.** These two slices shipped with their ownership rules
 * verified by hand against the deployed API and never written down as assertions.
 * That verification was not repeatable and did not run in CI, which for the one
 * part of the system that *is* the trust boundary — there is no RLS in RDS — is
 * the gap that matters most. Every rule in the ownership table in
 * docs/MIGRATION-PROGRESS.md for `coach_requests`,
 * `coach_athlete_relationships`, `conversations` and `messages` has a case here.
 *
 * **Both slices share one file because auth users are the scarce resource.**
 * Supabase signup is rate-limited per hour and cumulative across CI runs, and it
 * is the only dependency still on the shared project. Three users cover both
 * slices; splitting the file would cost six.
 *
 * The negative cases deliberately assert **404, not 403**. With enumerable ids a
 * 403 confirms the id names something real, which leaks who is training or
 * talking to whom — so "not yours" and "does not exist" must be indistinguishable
 * to the caller.
 */
describe('Coaching and messaging (e2e)', () => {
  let app: INestApplication;
  let supabase: SupabaseClient;

  let coach: TestUser;
  let athlete: TestUser;
  /** No relationship with `coach` and not a member of any conversation. Both an
   * athlete and a coach, so the same user covers the unrelated-athlete cases and
   * the rival-coach cases without spending a second signup. */
  let stranger: TestUser;

  /** Assigned by the invite test and consumed by the response tests — the accept
   * path cannot be set up independently, because creating the row by hand is
   * exactly the thing under test. */
  let requestId: string;
  let conversationId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror src/main.ts exactly, so these assertions describe production behaviour.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();

    supabase = moduleFixture.get(SupabaseService).getClient();

    const config = moduleFixture.get(ConfigService);
    const authClient = createAuthClient(
      config.get<string>('SUPABASE_PROJECT_URL')!,
      config.get<string>('SUPABASE_SECRET_KEY')!,
    );

    const track = (id: string) => createdUserIds.push(id);

    coach = await createTestUser(supabase, authClient, track);
    athlete = await createTestUser(supabase, authClient, track);
    stranger = await createTestUser(supabase, authClient, track);

    const reference = await findReferenceData();
    const db = dataDb();
    const markers = e2eProfileMarkers();

    // INSERT, not UPDATE: the Supabase trigger that created public.users at signup
    // does not exist in this database.
    for (const [user, isAthlete, isCoach] of [
      [coach, false, true],
      [athlete, true, false],
      [stranger, true, true],
    ] as Array<[TestUser, boolean, boolean]>) {
      await db.query(
        `insert into users (id, email, first_name, last_name, username, gender, date_of_birth,
                            is_athlete, is_coach)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.userId,
          user.email,
          markers.first_name,
          markers.last_name,
          user.username,
          reference.gender,
          '1995-06-15',
          isAthlete,
          isCoach,
        ],
      );
    }

    for (const user of [coach, stranger]) {
      await db.query('insert into coaches (id, biography) values ($1, $2)', [
        user.userId,
        'E2E coach',
      ]);
    }

    for (const user of [athlete, stranger]) {
      await db.query(
        `insert into athletes (id, federation_id, division_id, weight_class_id)
         values ($1, $2, $3, $4)`,
        [user.userId, reference.federationId, reference.divisionId, reference.weightClassId],
      );
    }

    // Deliberately NO coach_athlete_relationships row. The invite flow below is
    // what creates it, and asserting that is half the point of the file.
  });

  afterAll(async () => {
    await cleanupUsers(supabase, createdUserIds);
    if (app) await app.close();
    // Without this the pg pool keeps the process alive and Jest prints "did not
    // exit one second after the test run". `closeDataDb` is exported for exactly
    // this and was, until now, called by nothing.
    await closeDataDb();
  });

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: unknown) =>
      request(app.getHttpServer() as Server)
        .post(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body ?? {}),
    patch: (path: string, body?: unknown) =>
      request(app.getHttpServer() as Server)
        .patch(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body ?? {}),
  });

  describe('POST /coach-requests', () => {
    it('rejects a caller who is not a coach', async () => {
      // The athlete naming *the coach* as the athlete: even inverted, the caller
      // has to be a coach before anything else is considered.
      await as(athlete).post('/coach-requests', { athlete_id: coach.userId }).expect(403);
    });

    it('rejects a malformed athlete_id before touching the database', async () => {
      const res = await as(coach).post('/coach-requests', { athlete_id: 'not-a-uuid' }).expect(400);
      expect(res.body.message).toContain('athlete_id must be a valid UUID');
    });

    it('rejects a coach_id supplied by the client', async () => {
      // The invite must name only the athlete; the coach comes from the token.
      // Accepting this field is how a caller could forge an invite from someone else.
      const res = await as(coach)
        .post('/coach-requests', { athlete_id: athlete.userId, coach_id: stranger.userId })
        .expect(400);
      expect(res.body.message).toContain('property coach_id should not exist');
    });

    it('lets a coach invite an athlete', async () => {
      await as(coach).post('/coach-requests', { athlete_id: athlete.userId }).expect(201);

      const db = dataDb();
      const { rows } = await db.query(
        `select coach_id, status from coach_requests where athlete_id = $1`,
        [athlete.userId],
      );

      // The stored coach is the caller, not anything the body could have named.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ coach_id: coach.userId, status: 'pending' });
    });
  });

  describe('GET /coach-requests', () => {
    it('shows the invited athlete their pending request', async () => {
      const res = await as(athlete).get('/coach-requests').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        coach_id: coach.userId,
        athlete_id: athlete.userId,
        status: 'pending',
        coach_username: coach.username,
      });

      requestId = res.body[0].id;
    });

    it('shows an unrelated user nothing', async () => {
      const res = await as(stranger).get('/coach-requests').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PATCH /coach-requests/:id', () => {
    it('does not let the sending coach accept their own invite', async () => {
      await as(coach).patch(`/coach-requests/${requestId}`, { status: 'accepted' }).expect(404);
    });

    it('does not let an unrelated user respond', async () => {
      await as(stranger).patch(`/coach-requests/${requestId}`, { status: 'rejected' }).expect(404);
    });

    it('rejects a move back to pending', async () => {
      // Resolving is one-way; otherwise an athlete could un-decline indefinitely.
      const res = await as(athlete)
        .patch(`/coach-requests/${requestId}`, { status: 'pending' })
        .expect(400);
      expect(res.body.message).toContain('status must be either accepted or rejected');
    });

    it('rejects a malformed id with a 400 rather than a 500', async () => {
      await as(athlete).patch('/coach-requests/not-a-uuid', { status: 'accepted' }).expect(400);
    });

    it('lets the named athlete accept, which creates the relationship', async () => {
      await as(athlete).patch(`/coach-requests/${requestId}`, { status: 'accepted' }).expect(200);

      const db = dataDb();
      const { rows } = await db.query(
        `select coach_id, status from coach_athlete_relationships where athlete_id = $1`,
        [athlete.userId],
      );

      // Derived server-side from the stored accepted request — never client input.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ coach_id: coach.userId, status: 'active' });
    });

    it('drops the request from the athlete’s pending list once resolved', async () => {
      const res = await as(athlete).get('/coach-requests').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /coach-requests/roster', () => {
    it('shows the coach their athlete', async () => {
      const res = await as(coach).get('/coach-requests/roster').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        coach_id: coach.userId,
        athlete_id: athlete.userId,
        username: athlete.username,
      });
    });

    it('scopes the roster to the caller rather than returning every coach’s', async () => {
      // `stranger` is a coach too, so a roster that ignored the caller would leak
      // the row above. The athlete is not a coach at all and must also see nothing.
      for (const user of [stranger, athlete]) {
        const res = await as(user).get('/coach-requests/roster').expect(200);
        expect(res.body).toEqual([]);
      }
    });

    it('rejects re-inviting an athlete already on the roster', async () => {
      const res = await as(coach)
        .post('/coach-requests', { athlete_id: athlete.userId })
        .expect(400);
      expect(res.body.message).toContain('already on your roster');
    });
  });

  describe('POST /conversations', () => {
    it('rejects a malformed participant_id', async () => {
      const res = await as(coach)
        .post('/conversations', { participant_id: 'not-a-uuid' })
        .expect(400);
      expect(res.body.message).toContain('participant_id must be a valid UUID');
    });

    it('opens a thread and adds both participants as members', async () => {
      const res = await as(coach)
        .post('/conversations', { participant_id: athlete.userId })
        .expect(201);

      expect(res.body.conversation_id).toEqual(expect.any(String));
      conversationId = res.body.conversation_id;

      const db = dataDb();
      const { rows } = await db.query(
        `select user_id from conversation_members where conversation_id = $1 order by user_id`,
        [conversationId],
      );

      // Membership is never client-supplied: the caller is added server-side, which
      // is what stops someone inserting themselves into a stranger's thread.
      expect(rows.map((r: { user_id: string }) => r.user_id).sort()).toEqual(
        [coach.userId, athlete.userId].sort(),
      );
    });

    it('is idempotent for the same pair', async () => {
      const res = await as(coach)
        .post('/conversations', { participant_id: athlete.userId })
        .expect(201);

      expect(res.body.conversation_id).toBe(conversationId);
    });
  });

  describe('conversation messages', () => {
    it('lets a member send a message', async () => {
      const res = await as(coach)
        .post(`/conversations/${conversationId}/messages`, { content: 'Session moved to 6pm' })
        .expect(201);

      expect(res.body).toMatchObject({ id: expect.any(String), sent_at: expect.any(String) });
    });

    it('lets the other member read it, joined to the sender', async () => {
      const res = await as(athlete).get(`/conversations/${conversationId}/messages`).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        conversation_id: conversationId,
        content: 'Session moved to 6pm',
        sender_id: coach.userId,
        message_type: 'text',
      });
    });

    it('rejects empty content', async () => {
      const res = await as(coach)
        .post(`/conversations/${conversationId}/messages`, { content: '' })
        .expect(400);
      expect(res.body.message).toContain('content should not be empty');
    });

    it('rejects an unknown message_type', async () => {
      const res = await as(coach)
        .post(`/conversations/${conversationId}/messages`, { content: 'hi', message_type: 'gif' })
        .expect(400);
      expect(res.body.message).toContain('message_type must be one of text, image, video, file');
    });

    it('rejects a sender_id supplied by the client', async () => {
      // The sender comes from the token and the conversation from the route, so
      // neither can be spoofed.
      const res = await as(coach)
        .post(`/conversations/${conversationId}/messages`, {
          content: 'spoofed',
          sender_id: athlete.userId,
        })
        .expect(400);
      expect(res.body.message).toContain('property sender_id should not exist');
    });

    it('hides the thread from a non-member entirely', async () => {
      // 404 rather than 403 on all three: a 403 would confirm the conversation is real.
      await as(stranger).get(`/conversations/${conversationId}/messages`).expect(404);
      await as(stranger)
        .post(`/conversations/${conversationId}/messages`, { content: 'let me in' })
        .expect(404);
      await as(stranger).post(`/conversations/${conversationId}/read`).expect(404);
    });

    it('did not write the non-member’s message', async () => {
      const db = dataDb();
      const { rows } = await db.query(
        `select count(*)::int as n from messages where conversation_id = $1`,
        [conversationId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('rejects a malformed conversation id with a 400 rather than a 500', async () => {
      await as(athlete).get('/conversations/not-a-uuid/messages').expect(400);
    });

    it('lets a member mark the thread read', async () => {
      await as(athlete).post(`/conversations/${conversationId}/read`).expect(200);
    });
  });

  describe('GET /conversations', () => {
    it('lists the thread for both participants and nobody else', async () => {
      for (const user of [coach, athlete]) {
        const res = await as(user).get('/conversations').expect(200);
        const ids = res.body.map((c: { conversation_id: string }) => c.conversation_id);
        expect(ids).toContain(conversationId);
      }

      const outsider = await as(stranger).get('/conversations').expect(200);
      expect(outsider.body).toEqual([]);
    });

    it('returns one row per member, scoped to the caller', async () => {
      // user_conversations_view emits a row per (conversation, member); the caller
      // filter is what stops the athlete's row appearing in the coach's inbox.
      const res = await as(coach).get('/conversations').expect(200);
      const row = res.body.find(
        (c: { conversation_id: string }) => c.conversation_id === conversationId,
      );

      expect(row).toMatchObject({
        user_id: coach.userId,
        other_user_id: athlete.userId,
        last_message_content: 'Session moved to 6pm',
      });
    });
  });
});
