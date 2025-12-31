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
