import { supabase } from "@/lib/supabase";

export async function fetchAthleteProfile(athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes_view")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();

  if (error) throw error;
  return data;
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

  const existingIds = new Set(existingAthletes?.map((a) => a.athlete_id) || []);

  const { data, error } = await supabase
    .from("user_profiles_enriched_view")
    .select("*")
    .or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,username.ilike.%${query}%`
    )
    .limit(50);

  if (error) throw error;

  const filteredResults = (data || [])
    .filter((user) => !existingIds.has(user.id))
    .slice(0, 20);

  return filteredResults;
}
