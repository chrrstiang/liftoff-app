import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { and, eq, ilike, ne, notInArray, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
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
import {
  VALID_ATHLETES_COLUMNS_QUERIES,
  VALID_FULL_TABLE_QUERIES,
  VALID_TABLE_FIELDS,
} from 'src/common/types/select.queries';
import { UpdateAthleteDto } from '../../dto/athlete/update-athlete.dto';
import {
  assertDivisionInFederation,
  assertFederationExists,
  assertWeightClassMatches,
} from '../reference-validation';

/** Maps the snake_case names the `?data=` API speaks to real Drizzle columns.
 *
 * The API's vocabulary is the database's old column names, and Drizzle's schema
 * uses camelCase properties, so something has to bridge them. Doing it with an
 * explicit map rather than a transform keeps the allowlists in
 * select.queries.ts as the single source of truth for what is reachable.
 */
const ATHLETE_COLUMNS: Record<string, PgColumn> = {
  id: athletes.id,
  federation_id: athletes.federationId,
  division_id: athletes.divisionId,
  weight_class_id: athletes.weightClassId,
  team_id: athletes.teamId,
};

const RELATED_COLUMNS: Record<string, Record<string, PgColumn>> = {
  users: {
    first_name: users.firstName,
    last_name: users.lastName,
    username: users.username,
    gender: users.gender,
  },
  federations: { id: federations.id, name: federations.name, code: federations.code },
  divisions: {
    id: divisions.id,
    federation_id: divisions.federationId,
    name: divisions.name,
    minimum_age: divisions.minimumAge,
    maximum_age: divisions.maximumAge,
  },
  weight_classes: {
    id: weightClasses.id,
    federation_id: weightClasses.federationId,
    name: weightClasses.name,
    gender: weightClasses.gender,
    min_weight: weightClasses.minWeight,
    max_weight: weightClasses.maxWeight,
    sort_order: weightClasses.sortOrder,
    active: weightClasses.active,
  },
};

/** What `?data=` compiled to, as a structure rather than a PostgREST string. */
interface QueryPlan {
  direct: string[];
  nested: Record<string, string[]>;
}

/** The shape returned when no `data` param is given. Previously a literal select
 * string (PUBLIC_PROFILE_QUERY); expressed as a plan now so there is one code
 * path. Deliberately omits users.email — another user's PII on a profile
 * endpoint — and there is no users.role column at all. */
const DEFAULT_PLAN: QueryPlan = {
  direct: ['id'],
  nested: {
    users: ['first_name', 'last_name', 'username', 'gender'],
    federations: ['*'],
    divisions: ['*'],
    weight_classes: ['*'],
  },
};

/** Business logic for AthleteController: the sparse-fieldset profile read.
 *
 * Ported from supabase-js. The allowlists are unchanged and remain a security
 * boundary — with no RLS behind this, they are the only thing constraining what
 * the endpoint will return.
 */
@Injectable()
export class AthleteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Returns the requested columns of an athlete's profile.
   *
   * @param athleteId The athlete to read.
   * @param data Requested fields; the default profile when omitted.
   */
  async retrieveProfileDetails(athleteId: string, data?: string[]) {
    const plan = this.buildPlan(this.cleanDataArray(data));

    const selection: Record<string, PgColumn> = {};
    for (const field of plan.direct) {
      selection[`athletes.${field}`] = ATHLETE_COLUMNS[field];
    }
    for (const [table, columns] of Object.entries(plan.nested)) {
      const available = RELATED_COLUMNS[table];
      const wanted = columns.includes('*') ? Object.keys(available) : columns;
      for (const column of wanted) {
        selection[`${table}.${column}`] = available[column];
      }
    }

    // Left joins throughout: federation_id, division_id and weight_class_id are
    // all nullable, and an athlete without them should still return a row rather
    // than disappearing.
    const rows = await this.db
      .select(selection)
      .from(athletes)
      .leftJoin(users, eq(users.id, athletes.id))
      .leftJoin(federations, eq(federations.id, athletes.federationId))
      .leftJoin(divisions, eq(divisions.id, athletes.divisionId))
      .leftJoin(weightClasses, eq(weightClasses.id, athletes.weightClassId))
      .where(eq(athletes.id, athleteId))
      .limit(1);

    if (rows.length === 0) return null;

    return this.nest(rows[0] as Record<string, unknown>, plan);
  }

  /** Updates the caller's own `athletes` row — federation, division, weight class.
   *
   * ⚠️ **The id comes from the verified token and nothing else.** There is no id
   * parameter and no id field on the DTO, so there is no id to tamper with: the
   * only reachable row is the caller's. With no RLS behind this, `eq(athletes.id,
   * user.id)` on both the read and the write is the entire authorization, and the
   * same reasoning is why `updateUserAvatar` on the client lost its `userId`
   * argument.
   *
   * **A caller with no `athletes` row gets a 404**, and it is the caller's own row,
   * so the 404-over-403 question does not arise — nothing is disclosed either way.
   * Coaches who are not also athletes land here.
   *
   * **Validation runs against the merged row, not the request.** A PATCH carrying
   * only `division_id` has to be checked against the federation already stored, or
   * a client could move an athlete to a division belonging to a different
   * federation one field at a time. The corollary is that changing federation
   * alone is a 400 while a stale division is still on the row — the client sends
   * the three together, which is what `edit-profile.tsx` does.
   *
   * No driver-error mapping here, deliberately: every id is proven to exist
   * immediately above the write, and `athletes` has no other constraint this can
   * violate. A failure at that point is a real server error and belongs in
   * `GlobalExceptionFilter`, not dressed up as a 400.
   *
   * @param dto The columns to change. `null` clears one, absent leaves it alone.
   * @param user The authenticated caller, from the verified JWT.
   */
  async updateOwnProfile(dto: UpdateAthleteDto, user: User): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (dto.federation_id !== undefined) patch.federationId = dto.federation_id;
    if (dto.division_id !== undefined) patch.divisionId = dto.division_id;
    if (dto.weight_class_id !== undefined) patch.weightClassId = dto.weight_class_id;

    // An empty PATCH would become `set {}`, which Drizzle rejects — and there is
    // nothing to authorize or validate, so return before touching the database.
    if (Object.keys(patch).length === 0) return;

    const [current] = await this.db
      .select({
        federationId: athletes.federationId,
        divisionId: athletes.divisionId,
        weightClassId: athletes.weightClassId,
        // Weight classes are gendered, and gender lives on `users`. Read it here
        // rather than trusting a client-supplied value: a PATCH that also changed
        // gender would otherwise be able to validate against the gender it wished
        // it had.
        gender: users.gender,
      })
      .from(athletes)
      .innerJoin(users, eq(users.id, athletes.id))
      .where(eq(athletes.id, user.id))
      .limit(1);

    if (!current) {
      throw new NotFoundException('No athlete profile exists for this user');
    }

    const federationId = dto.federation_id !== undefined ? dto.federation_id : current.federationId;
    const divisionId = dto.division_id !== undefined ? dto.division_id : current.divisionId;
    const weightClassId =
      dto.weight_class_id !== undefined ? dto.weight_class_id : current.weightClassId;

    // Reads, and they must produce a clean 400 rather than a rejected write —
    // same ordering rule as createUserProfile.
    if (federationId) {
      await assertFederationExists(this.db, federationId);
    }
    if (divisionId) {
      await assertDivisionInFederation(this.db, divisionId, federationId);
    }
    if (weightClassId) {
      await assertWeightClassMatches(this.db, weightClassId, federationId, current.gender);
    }

    await this.db.update(athletes).set(patch).where(eq(athletes.id, user.id));
  }

  /** Rebuilds the nested shape the endpoint has always returned, so the response
   * contract survives the move off PostgREST:
   *   { id, users: {...}, federations: {...} } */
  private nest(flat: Record<string, unknown>, plan: QueryPlan) {
    const result: Record<string, unknown> = {};

    for (const field of plan.direct) {
      result[field] = flat[`athletes.${field}`];
    }

    for (const [table, columns] of Object.entries(plan.nested)) {
      const available = RELATED_COLUMNS[table];
      const wanted = columns.includes('*') ? Object.keys(available) : columns;
      const nested: Record<string, unknown> = {};
      let present = false;

      for (const column of wanted) {
        const value = flat[`${table}.${column}`];
        nested[column] = value;
        if (value !== null && value !== undefined) present = true;
      }

      // A left join that matched nothing yields all-null columns; report that as
      // a null relation rather than an object full of nulls, which is what
      // PostgREST did.
      result[table] = present ? nested : null;
    }

    return result;
  }

  /** Removes duplicates and nested fields made redundant by a full-table request:
   * - [federation_id, federation_id, name] -> [federation_id, name]
   * - [federations, federations.id]        -> [federations]
   */
  private cleanDataArray(fields?: string[]): string[] | undefined {
    if (!fields || fields.length === 0) return undefined;

    const uniqueFields = [...new Set(fields)];
    const fullTables = uniqueFields.filter(
      (f) => !f.includes('.') && VALID_FULL_TABLE_QUERIES.has(f),
    );

    if (fullTables.length > 0) {
      return uniqueFields.filter((field) => {
        if (!field.includes('.')) return true;
        const [tableName] = field.split('.');
        return !fullTables.includes(tableName);
      });
    }

    return uniqueFields;
  }

  /** Validates the requested fields against the allowlists and returns a plan.
   *
   * ⚠️ Anything off-allowlist throws. These lists are the only constraint on what
   * this endpoint exposes, so widening them to make a query convenient widens the
   * endpoint's reach. `user_id` stays out because it maps to the auth identity.
   */
  private buildPlan(data?: string[]): QueryPlan {
    if (!data) return DEFAULT_PLAN;

    const plan: QueryPlan = { direct: [], nested: {} };

    for (const field of data) {
      if (field.includes('.')) {
        const [tableName, column] = field.split('.') as [string, string];

        if (
          !(tableName in VALID_TABLE_FIELDS) ||
          !VALID_TABLE_FIELDS[tableName as keyof typeof VALID_TABLE_FIELDS].includes(column)
        ) {
          throw new BadRequestException(`Invalid query: '${tableName}.${column}'`);
        }

        (plan.nested[tableName] ??= []).push(column);
      } else if (VALID_FULL_TABLE_QUERIES.has(field)) {
        plan.nested[field] = ['*'];
      } else {
        if (!VALID_ATHLETES_COLUMNS_QUERIES.has(field)) {
          throw new BadRequestException(`Invalid query: '${field}'`);
        }
        plan.direct.push(field);
      }
    }

    return plan;
  }

  /** Athlete search for the roster's invite flow. Replaces
   * `user_profiles_enriched_view` plus the client-side exclusion filter.
   *
   * Three things the client version got wrong, all fixed by moving it here:
   *
   * 1. **The search term was interpolated into a PostgREST `.or()` expression**,
   *    where `,` separates conditions and `()` groups them. A term containing
   *    either changed the meaning of the filter rather than being matched
   *    literally. `#8` added quoting as a mitigation; a parameterised `ilike`
   *    removes the class of problem instead.
   * 2. **The exclusion filter never excluded anybody.** It compared `user.id`
   *    against the already-invited set, but the view's identity column is
   *    `athlete_id` and there is no `id` — so it tested `undefined` every time and
   *    already-invited athletes kept appearing. It is a SQL `not in` now.
   * 3. **It fetched 50 rows to return 20.** The limit is applied after exclusion.
   *
   * `%` and `_` are escaped: unescaped, a term of `%` matches every athlete in the
   * database, which is a listing endpoint nobody asked for.
   */
  async searchAthletes(query: string, callerId: string, limit = 20) {
    // ⚠️ Coach-only, and this is the second half of closing the conversation
    // hole. `callerId` was previously used only to *exclude* athletes the caller
    // had already invited -- it never established that the caller was a coach at
    // all. So any signed-in user could enumerate every athlete's name, username,
    // federation and weight class, and the ids this returns were step one of
    // opening an unsolicited thread with any of them.
    //
    // `POST /exercises` and `POST /workouts` both gate on being a coach already;
    // this is the same rule, and it matches the UI -- the Roster tab that calls
    // this is behind `Tabs.Protected guard={profile.is_coach}`.
    await this.assertCoach(callerId);

    const term = query.trim();
    if (!term) return [];

    const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

    // Anyone this coach has already invited or signed. `pending` counts: an
    // athlete with an outstanding invite should not be offered again, which is the
    // whole point of the filter the client failed to apply.
    const connected = this.db
      .select({ athleteId: coachAthleteRelationships.athleteId })
      .from(coachAthleteRelationships)
      .where(eq(coachAthleteRelationships.coachId, callerId));

    const pendingInvites = this.db
      .select({ athleteId: coachRequests.athleteId })
      .from(coachRequests)
      .where(and(eq(coachRequests.coachId, callerId), eq(coachRequests.status, 'pending')));

    return this.db
      .select({
        athlete_id: users.id,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        avatar_url: users.avatarUrl,
        federation_id: athletes.federationId,
        federation_code: federations.code,
        weight_class_id: athletes.weightClassId,
        weight_class_name: weightClasses.name,
        division_id: athletes.divisionId,
        division_name: divisions.name,
      })
      .from(users)
      .innerJoin(athletes, eq(athletes.id, users.id))
      .leftJoin(federations, eq(federations.id, athletes.federationId))
      .leftJoin(weightClasses, eq(weightClasses.id, athletes.weightClassId))
      .leftJoin(divisions, eq(divisions.id, athletes.divisionId))
      .where(
        and(
          or(
            ilike(users.firstName, pattern),
            ilike(users.lastName, pattern),
            ilike(users.username, pattern),
          ),
          // Never offer the caller themselves.
          ne(users.id, callerId),
          notInArray(users.id, connected),
          notInArray(users.id, pendingInvites),
        ),
      )
      .limit(Math.min(limit, 50));
  }
  /** Only a coach may search the athlete directory.
   *
   * 403 rather than 404 deliberately, and it is the exception to this codebase's
   * 404-over-403 rule rather than a violation of it: that rule protects the
   * existence of a *resource* the caller has no claim on. Here there is no
   * resource in the request at all -- the caller is being told something about
   * their own account, which they already know.
   */
  private async assertCoach(callerId: string): Promise<void> {
    const [isCoach] = await this.db
      .select({ id: coaches.id })
      .from(coaches)
      .where(eq(coaches.id, callerId))
      .limit(1);

    if (!isCoach) {
      throw new ForbiddenException('Only a coach can search athletes');
    }
  }
}
