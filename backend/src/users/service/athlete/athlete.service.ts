import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { athletes, divisions, federations, users, weightClasses } from 'src/db/schema';
import {
  VALID_ATHLETES_COLUMNS_QUERIES,
  VALID_FULL_TABLE_QUERIES,
  VALID_TABLE_FIELDS,
} from 'src/common/types/select.queries';

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
}
