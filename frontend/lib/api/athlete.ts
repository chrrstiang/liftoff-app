import { supabase } from "@/lib/supabase";
import type { UserProfileEnriched } from "@/types";

export async function fetchAthleteProfile(athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes_view")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();

  if (error) throw error;
  return data;
}
/** Escapes a search term for use as a PostgREST filter value.
 *
 * `.or()` takes a raw filter expression, where `,` separates conditions and
 * parentheses group them. Interpolating a user's search string straight in means a
 * term containing either character changes the meaning of the filter rather than
 * being matched literally. PostgREST allows a value to be double-quoted to hold
 * reserved characters, so quote it — after removing the two characters that would
 * escape the quoting itself.
 */
function toFilterValue(query: string): string {
  return `"%${query.replace(/["\\]/g, "")}%"`;
}

// search for users based off query, filter athletes already connected to this coach
export async function searchAthletes(query: string, coachId: string) {
  const { data: existingAthletes, error: existingError } = await supabase
    .from("coach_athlete_relationships")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .in("status", ["active", "pending"]);

  if (existingError) {
    throw existingError;
  }

  const existingIds = new Set<string>(
    existingAthletes?.map((a) => a.athlete_id as string) || [],
  );

  const term = toFilterValue(query);

  const { data, error } = await supabase
    .from("user_profiles_enriched_view")
    .select("*")
    .or(
      `first_name.ilike.${term},last_name.ilike.${term},username.ilike.${term}`,
    )
    .limit(50);

  if (error) throw error;

  const results = (data || []) as UserProfileEnriched[];

  // Was `!existingIds.has(user.id)`. user_profiles_enriched_view has no `id`
  // column — its identity column is `athlete_id` — so this compared athlete ids
  // against `undefined` and excluded nobody. Already-invited athletes kept showing
  // up in search. It typechecked only because Supabase's `data` is untyped here.
  return results
    .filter((user) => !existingIds.has(user.athlete_id))
    .slice(0, 20);
}
