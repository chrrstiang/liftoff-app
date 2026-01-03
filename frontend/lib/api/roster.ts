import { supabase } from "@/lib/supabase";

export async function fetchRoster(coachId: string) {
  console.log("Coach ID: ", coachId);
  const { data, error } = await supabase
    .from("coach_athletes_view")
    .select("*")
    .eq("coach_id", coachId);

  if (error) throw error;
  return data;
}

export async function sendInvite(athleteId: string, coachId: string) {
  const { error } = await supabase
    .from("coach_requests")
    .insert({ athlete_id: athleteId, coach_id: coachId, status: "pending" });

  if (error) throw error;
  return { success: true };
}
