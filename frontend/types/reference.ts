/** Reference data: federations and their divisions / weight classes.
 *
 * Seeded manually in Supabase; nothing in the app creates these rows.
 *
 * ⚠️ `id` is a **uuid**, so `string`. These were previously declared `number` in
 * create-profile.tsx, which typechecked only because Supabase's `data` is untyped
 * — the values were always uuid strings at runtime. Verified against the live
 * schema; see docs/DB-SCHEMA.md.
 */

export interface Federation {
  id: string;
  name: string | null;
  code: string;
}

export interface Division {
  id: string;
  name: string | null;
  minimum_age: number | null;
  maximum_age: number | null;
}

export interface WeightClass {
  id: string;
  name: string | null;
  /** smallint in the schema — the client orders dropdowns by it. Was declared
   * `boolean`, which was simply wrong. */
  sort_order: number | null;
}
