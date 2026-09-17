import { supabase } from "@/lib/supabase";
import type { Division, Federation, WeightClass } from "@/types";

/** Reference-data reads: federations and their divisions / weight classes.
 *
 * ⚠️ **This is the one part of the app that still reads a table straight from
 * Supabase with the anon key**, and it is deliberate rather than an oversight —
 * see the data-path section of the root `CLAUDE.md`. These three tables are
 * public reference data (three federations, sixteen divisions, the weight
 * classes) and nothing user-owned is reachable through them. Nothing else should
 * follow the pattern.
 *
 * It lives here rather than inline in a screen because `edit-profile.tsx` is the
 * second screen to need it. `create-profile.tsx` still has its own copy in three
 * chained `useEffect`s — deliberately left alone, since its quirks are recorded
 * in `frontend/CLAUDE.md` and the signup flow is not what this change is about.
 * These are the functions it should adopt when someone touches it next.
 *
 * Each throws on failure so TanStack Query can report it, rather than returning
 * an empty list that looks like "this federation has no divisions".
 */

export async function fetchFederations(): Promise<Federation[]> {
  const { data, error } = await supabase
    .from("federations")
    .select("id, name, code");

  if (error) throw new Error(`Could not load federations: ${error.message}`);
  return data ?? [];
}

/** Divisions belonging to one federation. Age-banded, not gendered. */
export async function fetchDivisions(
  federationId: string,
): Promise<Division[]> {
  const { data, error } = await supabase
    .from("divisions")
    .select("id, name, minimum_age, maximum_age")
    .eq("federation_id", federationId);

  if (error) throw new Error(`Could not load divisions: ${error.message}`);
  return data ?? [];
}

/** Weight classes for one federation **and one gender**.
 *
 * Both filters are required, and that is the whole reason a weight class cannot
 * be identified by name: `weight_classes` is keyed by (federation, gender, name),
 * so "83" is a different row for men and for women inside the same federation.
 * The API validates the same triple on write — see `reference-validation.ts`.
 */
export async function fetchWeightClasses(
  federationId: string,
  gender: string,
): Promise<WeightClass[]> {
  const { data, error } = await supabase
    .from("weight_classes")
    .select("id, name, sort_order")
    .eq("federation_id", federationId)
    .eq("gender", gender)
    .order("sort_order");

  if (error) throw new Error(`Could not load weight classes: ${error.message}`);
  return data ?? [];
}
