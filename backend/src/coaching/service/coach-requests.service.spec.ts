import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { CoachRequestsService } from './coach-requests.service';

/** Responding to an invitation.
 *
 * ⚠️ The interesting case is a **race**, which a mocked client cannot stage
 * directly. What it can stage is the *observable consequence* of one: the UPDATE
 * matching zero rows because someone else already answered. That is exactly what
 * `.returning()` coming back empty means, and it is the signal the fix keys on.
 */
describe('CoachRequestsService.respondToRequest', () => {
  const ATHLETE = '22222222-2222-4222-8222-222222222222';
  const COACH = '11111111-1111-4111-8111-111111111111';
  const STRANGER = '33333333-3333-4333-8333-333333333333';
  const REQUEST = '44444444-4444-4444-8444-444444444444';

  let harness: TestDb;
  let service: CoachRequestsService;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoachRequestsService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<CoachRequestsService>(CoachRequestsService);
  }

  const pending = [{ id: REQUEST, athleteId: ATHLETE, coachId: COACH, status: 'pending' }];

  /** ⚠️ **The race this fix exists for.**
   *
   * Two responses are in flight. The reject commits first and flips the row to
   * `rejected`. The accept's UPDATE then matches zero rows — but before the fix
   * its INSERT was guarded by the `status` variable read *outside* the
   * transaction, so it ran anyway and created the relationship.
   *
   * The athlete declined and ended up on the roster. With no way to leave a
   * roster, that is permanent.
   */
  it('does not create the relationship when the request was already resolved', async () => {
    await build({
      // the read still sees 'pending' — that is the stale read
      coach_requests: [pending, []],
    });

    await service.respondToRequest(REQUEST, 'accepted', ATHLETE);

    const inserted = harness.writes.find(
      (w) => w.op === 'insert' && w.table === 'coach_athlete_relationships',
    );
    expect(inserted).toBeUndefined();
  });

  it('creates the relationship when the update actually took', async () => {
    await build({
      coach_requests: [pending, [{ id: REQUEST }]],
      coach_athlete_relationships: [[]],
    });

    await service.respondToRequest(REQUEST, 'accepted', ATHLETE);

    const inserted = harness.writes.find(
      (w) => w.op === 'insert' && w.table === 'coach_athlete_relationships',
    );
    expect(inserted!.values).toMatchObject({
      athleteId: ATHLETE,
      coachId: COACH,
      status: 'active',
    });
  });

  /** A reject must never create a relationship, whether or not the update took. */
  it('never creates a relationship on a rejection', async () => {
    await build({ coach_requests: [pending, [{ id: REQUEST }]] });

    await service.respondToRequest(REQUEST, 'rejected', ATHLETE);

    expect(harness.writes.some((w) => w.table === 'coach_athlete_relationships')).toBe(false);
  });

  /** The pair comes from the **stored row**, never the caller. This is what stops
   * an attacker fabricating a relationship between any two ids. */
  it('derives the pair from the stored request, not the caller', async () => {
    await build({
      coach_requests: [pending, [{ id: REQUEST }]],
      coach_athlete_relationships: [[]],
    });

    await service.respondToRequest(REQUEST, 'accepted', ATHLETE);

    const inserted = harness.writes.find(
      (w) => w.op === 'insert' && w.table === 'coach_athlete_relationships',
    );
    expect(inserted!.values).not.toMatchObject({ coachId: STRANGER });
  });

  it('404s someone who is not the athlete named on the request', async () => {
    await build({ coach_requests: [pending] });

    await expect(service.respondToRequest(REQUEST, 'accepted', STRANGER)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(harness.writes).toHaveLength(0);
  });

  it('rejects responding to a request that is already resolved', async () => {
    await build({
      coach_requests: [[{ ...pending[0], status: 'accepted' }]],
    });

    await expect(service.respondToRequest(REQUEST, 'rejected', ATHLETE)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(harness.writes).toHaveLength(0);
  });

  it('404s a request that does not exist', async () => {
    await build({ coach_requests: [[]] });

    await expect(service.respondToRequest(REQUEST, 'accepted', ATHLETE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
