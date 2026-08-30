import { api } from "@/lib/api/client";
import type { AthleteProfileView } from "@/types";

/** The calling coach's roster. `coachId` is gone — the API scopes it to the token. */
export async function fetchRoster() {
  return api.get<AthleteProfileView[]>("/coach-requests/roster");
}

/** Invites an athlete.
 *
 * `coachId` is gone from the signature, and that is the entire point: the invite
 * names the *caller* as coach, server-side. The client used to insert the row
 * directly with both ids, so any authenticated user could fabricate an invitation
 * from any coach to any athlete.
 */
export async function sendInvite(athleteId: string) {
  await api.post("/coach-requests", { athlete_id: athleteId });
  return { success: true };
}
