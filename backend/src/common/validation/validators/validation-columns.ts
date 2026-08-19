import type { PgColumn } from 'drizzle-orm/pg-core';
import { divisions, federations, users, weightClasses } from 'src/db/schema';

/** The table/column pairs the DB-backed validators are allowed to touch.
 *
 * The `@IsUnique('users', 'username')` and `@ValueExists('federations', 'code')`
 * decorators pass table and column as plain strings, which worked against
 * supabase-js because `.from(x).select(y)` takes strings too. Drizzle is typed,
 * so those strings have to resolve to real column objects somewhere — this is
 * that somewhere.
 *
 * Making it an explicit allowlist rather than a dynamic lookup means an
 * unregistered pair fails loudly at validation time instead of composing a query
 * against a table nobody meant to expose. The decorator arguments are authored in
 * this repo rather than user input, so this is defence in depth rather than the
 * only guard — but it is the same reasoning as the `?data=` allowlists.
 */
const VALIDATABLE_COLUMNS: Record<string, PgColumn> = {
  'users.username': users.username,
  'federations.code': federations.code,
  'weight_classes.name': weightClasses.name,
  'divisions.name': divisions.name,
};

export function resolveValidatableColumn(table: string, column: string): PgColumn | undefined {
  return VALIDATABLE_COLUMNS[`${table}.${column}`];
}

export function validatableColumnKeys(): string[] {
  return Object.keys(VALIDATABLE_COLUMNS);
}
