import { api } from "@/lib/api/client";
import type { CoachRequest } from "@/types";

/** Coach invitations addressed to the caller.
 *
 * The `athleteId` parameter is gone: the API scopes this to the token holder, so
 * an athlete can only ever see their own invitations. Previously the filter was
 * client-supplied, which meant it was advisory — the anon key could read anyone's.
 */
export async function fetchAthleteRequests() {
  return api.get<CoachRequest[]>("/coach-requests");
}

/** Accepts or declines an invitation.
 *
 * ⚠️ **The relationship row is no longer created here.** The client used to
 * update `coach_requests` and then insert into `coach_athlete_relationships`
 * itself, taking the coach and athlete ids from the response — two unguarded
 * writes where the second could name any pair at all. The API now derives the
 * relationship from the stored request inside a transaction, so a partial accept
 * (status updated, relationship missing) is no longer reachable either.
 */
export async function respondToRequest(
  requestId: string,
  status: "accepted" | "rejected",
) {
  await api.patch(`/coach-requests/${requestId}`, { status });
}
