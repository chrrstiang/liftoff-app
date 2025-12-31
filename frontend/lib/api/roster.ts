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
