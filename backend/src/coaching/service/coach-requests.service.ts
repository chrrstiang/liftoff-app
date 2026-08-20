import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import {
  athletes,
  coachAthleteRelationships,
  coachRequests,
  coaches,
  divisions,
  federations,
  users,
  weightClasses,
} from 'src/db/schema';

/** Coach ↔ athlete invitations.
 *
 * ⚠️ **There is no RLS behind any of this.** Every rule below is the entire
 * authorization for that operation. On Supabase, `coach_athlete_relationships`
 * had `with_check (true)`, so any authenticated client could insert a
 * relationship naming anyone as coach of anyone. These rules are what replace
 * that — getting one wrong is a data breach, not a bug.
 */
@Injectable()
export class CoachRequestsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** A coach invites an athlete.
   *
   * Rules:
   * - the caller must have a `coaches` row (you cannot invite as a coach you are not)
   * - the invite always names the CALLER as coach; `coach_id` is never read from the body
   * - the athlete must exist
   * - no duplicate pending invite, and not already an active athlete
   */
  async createRequest(athleteId: string, callerId: string) {
    const [isCoach] = await this.db
      .select({ id: coaches.id })
      .from(coaches)
      .where(eq(coaches.id, callerId))
      .limit(1);

    if (!isCoach) {
      throw new ForbiddenException('Only a coach can send an invitation');
    }

    if (athleteId === callerId) {
      throw new BadRequestException('You cannot invite yourself');
    }

    const [athlete] = await this.db
      .select({ id: athletes.id })
      .from(athletes)
      .where(eq(athletes.id, athleteId))
      .limit(1);

    if (!athlete) {
      throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
    }

    const [existingRelationship] = await this.db
      .select({ id: coachAthleteRelationships.id })
      .from(coachAthleteRelationships)
      .where(
        and(
          eq(coachAthleteRelationships.athleteId, athleteId),
          eq(coachAthleteRelationships.coachId, callerId),
          eq(coachAthleteRelationships.status, 'active'),
        ),
      )
      .limit(1);

    if (existingRelationship) {
      throw new BadRequestException('This athlete is already on your roster');
    }

    const [pending] = await this.db
      .select({ id: coachRequests.id })
      .from(coachRequests)
      .where(
        and(
          eq(coachRequests.athleteId, athleteId),
          eq(coachRequests.coachId, callerId),
          eq(coachRequests.status, 'pending'),
        ),
      )
      .limit(1);

    if (pending) {
      throw new BadRequestException('An invitation is already pending for this athlete');
    }

    const [created] = await this.db
      .insert(coachRequests)
      .values({ athleteId, coachId: callerId, status: 'pending' })
      .returning({ id: coachRequests.id });

    return created;
  }

  /** The invited athlete accepts or declines.
   *
   * Rules:
   * - only the athlete NAMED ON THE REQUEST may respond; the caller id is checked
   *   against the stored row, never against anything supplied by the client
   * - only a pending request can be resolved
   * - on accept, the relationship is **derived from the stored request** inside a
   *   transaction, so the pair can never be attacker-chosen
   */
  async respondToRequest(requestId: string, status: 'accepted' | 'rejected', callerId: string) {
    const [request] = await this.db
      .select({
        id: coachRequests.id,
        athleteId: coachRequests.athleteId,
        coachId: coachRequests.coachId,
        status: coachRequests.status,
      })
      .from(coachRequests)
      .where(eq(coachRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new NotFoundException(`Request with ID ${requestId} could not be found`);
    }

    // Deliberately the same 404, not a 403: telling a stranger that a request
    // exists but is not theirs leaks that the coach/athlete pair exists at all.
    if (request.athleteId !== callerId) {
      throw new NotFoundException(`Request with ID ${requestId} could not be found`);
    }

    if (request.status !== 'pending') {
      throw new BadRequestException(`This request has already been ${request.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(coachRequests)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(coachRequests.id, requestId), eq(coachRequests.status, 'pending')));

      if (status === 'accepted') {
        await tx
          .insert(coachAthleteRelationships)
          .values({
            // From the stored row, never from the request body.
            athleteId: request.athleteId,
            coachId: request.coachId,
            status: 'active',
          })
          .onConflictDoNothing();
      }
    });
  }

  /** Pending invitations addressed to the caller. Scoped by the caller's id, so
   * an athlete can only ever see their own. */
  async listRequestsForAthlete(callerId: string) {
    return this.db
      .select({
        id: coachRequests.id,
        created_at: coachRequests.createdAt,
        coach_id: coachRequests.coachId,
        athlete_id: coachRequests.athleteId,
        status: coachRequests.status,
        coach_username: users.username,
        coach_avatar_url: users.avatarUrl,
      })
      .from(coachRequests)
      .innerJoin(coaches, eq(coaches.id, coachRequests.coachId))
      .innerJoin(users, eq(users.id, coaches.id))
      .where(and(eq(coachRequests.athleteId, callerId), eq(coachRequests.status, 'pending')))
      .orderBy(desc(coachRequests.createdAt));
  }

  /** The caller's roster. Replaces `coach_athletes_view`; the join is the same
   * one that view performed, with the caller's id bound rather than assumed. */
  async listRoster(callerId: string) {
    return this.db
      .select({
        coach_id: coachAthleteRelationships.coachId,
        athlete_id: coachAthleteRelationships.athleteId,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
        federation_code: federations.code,
        division_name: divisions.name,
        weight_class_name: weightClasses.name,
      })
      .from(coachAthleteRelationships)
      .innerJoin(athletes, eq(athletes.id, coachAthleteRelationships.athleteId))
      .innerJoin(users, eq(users.id, athletes.id))
      .leftJoin(federations, eq(federations.id, athletes.federationId))
      .leftJoin(divisions, eq(divisions.id, athletes.divisionId))
      .leftJoin(weightClasses, eq(weightClasses.id, athletes.weightClassId))
      .where(
        and(
          eq(coachAthleteRelationships.coachId, callerId),
          eq(coachAthleteRelationships.status, 'active'),
        ),
      );
  }
}
