import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { ConversationsService } from './conversations.service';

/** Who may **start** a conversation.
 *
 * ⚠️ Every other messaging rule is enforced by `assertMember`, and those were
 * always correct. The hole was that membership itself was created on demand for
 * any two user ids — so `assertMember` guarded a door the caller had already
 * walked through. These tests pin the gate that was missing.
 *
 * The mocked Drizzle client ignores `where`, so what these show is *which checks
 * ran and whether anything was written* — which is the question here, because the
 * bug was a check that did not exist rather than one that was mis-scoped.
 */
describe('ConversationsService.createConversation', () => {
  const CALLER = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  let harness: TestDb;
  let service: ConversationsService;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationsService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  }

  const RELATIONSHIP = [{ id: 'rel' }];

  it('refuses to start a conversation with an unrelated user, and writes nothing', async () => {
    await build({
      users: [[{ id: OTHER }]],
      coach_athlete_relationships: [[]],
    });

    await expect(service.createConversation(OTHER, CALLER)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(harness.writes).toHaveLength(0);
  });

  /** 404 rather than 403, matching the rest of the codebase: a 403 would confirm
   * that the id names a real user, which with an enumerable directory tells an
   * attacker who exists. */
  it('reports the refusal as a 404, not a 403', async () => {
    await build({ users: [[{ id: OTHER }]], coach_athlete_relationships: [[]] });

    await expect(service.createConversation(OTHER, CALLER)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('allows it when an active relationship exists', async () => {
    await build({
      users: [[{ id: OTHER }]],
      coach_athlete_relationships: [RELATIONSHIP],
      // no existing shared thread, then the insert
      conversation_members: [[], []],
      conversations: [[{ id: 'new-conversation' }]],
    });

    const result = await service.createConversation(OTHER, CALLER);

    expect(result).toMatchObject({ created: true });
  });

  /** ⚠️ Bidirectional on purpose. A coach messaging their athlete and an athlete
   * messaging their coach are the same conversation, and neither side should have
   * to be the one who starts it. The mock cannot distinguish the two directions —
   * what it pins is that ONE relationship row is enough, rather than the caller
   * needing to be the coach specifically. */
  it('does not require the caller to be the coach side of the relationship', async () => {
    await build({
      users: [[{ id: OTHER }]],
      coach_athlete_relationships: [RELATIONSHIP],
      conversation_members: [[], []],
      conversations: [[{ id: 'new-conversation' }]],
    });

    await expect(service.createConversation(OTHER, CALLER)).resolves.toMatchObject({
      created: true,
    });
  });

  it('still rejects messaging yourself, before any lookup', async () => {
    await build({});

    await expect(service.createConversation(CALLER, CALLER)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(harness.writes).toHaveLength(0);
  });

  it('still 404s a participant who does not exist', async () => {
    await build({ users: [[]] });

    await expect(service.createConversation(OTHER, CALLER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /** An existing thread is returned rather than duplicated, and that path must
   * stay reachable — otherwise tightening creation would strand people in
   * conversations they can no longer re-open. */
  it('returns an existing thread without needing to create one', async () => {
    await build({
      users: [[{ id: OTHER }]],
      coach_athlete_relationships: [RELATIONSHIP],
      conversation_members: [[{ id: 'shared' }], [{ id: 'shared' }]],
    });

    const result = await service.createConversation(OTHER, CALLER);

    expect(result).toEqual({ id: 'shared', created: false });
    expect(harness.writes).toHaveLength(0);
  });
});
