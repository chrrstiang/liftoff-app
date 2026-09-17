import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from 'src/db/db.module';
import { divisions, federations, weightClasses } from 'src/db/schema';

/** Cross-field validation for the three reference-data columns on `athletes`.
 *
 * `federation_id`, `division_id` and `weight_class_id` each have a foreign key,
 * so the database will reject an id that names nothing — but it has no opinion on
 * whether the *combination* makes sense. A division belongs to exactly one
 * federation and a weight class to one federation and one gender, and neither
 * constraint is expressible as a foreign key. Checking it is application code.
 *
 * These were private methods on `UsersService`, reachable only from
 * `createUserProfile`. `PATCH /athlete/profile` needs the same three rules against
 * the *merged* state of an athlete's row, so they live here rather than being
 * written twice — a second copy is how the create and update paths end up
 * disagreeing about what a valid selection is.
 *
 * Every function throws `BadRequestException` and nothing else, so callers can run
 * them before opening a transaction and get a clean 400 rather than an aborted
 * write.
 */

/** Postgres rejects a malformed uuid with 22P02 before any row is examined, so
 * this is used only to name which of several candidate ids was the bad one. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs a reference-data lookup, turning a malformed uuid into a 400.
 *
 * PostgREST used to reject a bad uuid as a request error, which the service
 * mapped to a 400 naming the offending value. Postgres raises 22P02
 * (invalid_text_representation) instead, which would otherwise escape as an
 * unhandled 500 — the client sent bad input and deserves to be told which part.
 */
async function runReferenceLookup<T>(run: () => Promise<T[]>, candidates: string[]): Promise<T[]> {
  try {
    return await run();
  } catch (error) {
    if ((error as { cause?: { code?: string } })?.cause?.code === '22P02') {
      const malformed = candidates.find((c) => !UUID_PATTERN.test(c)) ?? candidates.join(', ');
      throw new BadRequestException(`Invalid identifier: '${malformed}'`);
    }
    throw error;
  }
}

/** Asserts the federation exists.
 *
 * `updateOwnProfile` calls this on every patch that leaves a federation set, even
 * though the two checks below would usually prove it as a side effect — a division
 * or weight class is only found when it belongs to this federation. The redundancy
 * is one `select 1` and it buys the case that is otherwise unguarded: a patch that
 * sets a federation while clearing the other two, or on a row that has neither.
 * Leaving it to the foreign key there would surface a bogus id as a masked 500
 * rather than "Federation not found".
 *
 * `createUserProfile` does not call it, deliberately — that path is unchanged, and
 * widening its validation is not this endpoint's business.
 *
 * @param db The Drizzle handle.
 * @param federationId The federation to check.
 */
export async function assertFederationExists(db: Database, federationId: string): Promise<void> {
  const rows = await runReferenceLookup(
    () =>
      db
        .select({ one: sql<number>`1` })
        .from(federations)
        .where(eq(federations.id, federationId))
        .limit(1),
    [federationId],
  );

  if (rows.length === 0) throw new BadRequestException('Federation not found');
}

/** Asserts the division exists *and* belongs to the given federation.
 *
 * @param db The Drizzle handle.
 * @param divisionId The division to check.
 * @param federationId The federation it must belong to. Required — a division id
 *   on its own cannot be validated, and silently accepting one would let a
 *   division from another federation through.
 */
export async function assertDivisionInFederation(
  db: Database,
  divisionId: string,
  federationId?: string | null,
): Promise<void> {
  if (!federationId) {
    throw new BadRequestException('Federation is required to validate division');
  }

  const rows = await runReferenceLookup(
    () =>
      db
        .select({ one: sql<number>`1` })
        .from(divisions)
        .where(and(eq(divisions.id, divisionId), eq(divisions.federationId, federationId)))
        .limit(1),
    [divisionId, federationId],
  );

  if (rows.length === 0) throw new BadRequestException('Division not found');
}

/** Asserts the weight class exists and matches both the federation and the gender.
 *
 * Gender is part of the key because weight classes are gendered: the same `name`
 * ("83") exists for men and for women inside one federation as two different rows.
 * That is also the reason the name-based `UpdateAthleteDto` this endpoint was
 * originally specced with could not work — see the comment on that DTO.
 *
 * @param db The Drizzle handle.
 * @param weightClassId The weight class to check.
 * @param federationId The federation it must belong to.
 * @param gender The gender it must be for — `users.gender`, which is nullable.
 */
export async function assertWeightClassMatches(
  db: Database,
  weightClassId: string,
  federationId: string | null | undefined,
  gender: string | null | undefined,
): Promise<void> {
  if (!federationId) {
    throw new BadRequestException('Federation is required to validate weight class');
  }

  if (!gender) {
    throw new BadRequestException('Gender is required to validate weight class');
  }

  const rows = await runReferenceLookup(
    () =>
      db
        .select({ one: sql<number>`1` })
        .from(weightClasses)
        .where(
          and(
            eq(weightClasses.id, weightClassId),
            eq(weightClasses.federationId, federationId),
            // Compared as raw SQL rather than `eq`: gender arrives as a plain
            // string (from users.gender or the DTO), and the column is the
            // `gender` pg enum, which Drizzle's typed `eq` will not accept.
            sql`${weightClasses.gender} = ${gender}`,
          ),
        )
        .limit(1),
    [weightClassId, federationId],
  );

  if (rows.length === 0) throw new BadRequestException('Weight class not found');
}
