import { supabase } from "../supabase";

export async function fetchAthleteRequests(athleteId: string) {
  console.log("athleteId: ", athleteId);
  const { data, error } = await supabase
    .from("user_coach_requests_view")
    .select("*")
    .eq("athlete_id", athleteId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data;
}

export async function respondToRequest(requestId: string, status: string) {
  const { data: request, error: requestError } = await supabase
    .from("coach_requests")
    .update({ status })
    .eq("id", requestId)
    .select("coach_id, athlete_id")
    .single();

  if (requestError) throw requestError;

  if (request && status === "accepted") {
    const { error: relationshipError } = await supabase
      .from("coach_athlete_relationships")
      .insert({
        athlete_id: request.athlete_id,
        coach_id: request.coach_id,
        status: "active",
      });

    if (relationshipError) throw relationshipError;
  }
}
