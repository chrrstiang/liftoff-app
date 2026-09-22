import { api } from "@/lib/api/client";
import type { AthleteMax } from "@/types";

/** An athlete's maxes — what percentage prescription resolves against.
 *
 * Reads and writes have different rules, mirroring the backend: any active coach
 * of the athlete (and the athlete themselves) may read, but only a coach may
 * write. Setting a max is programming — an athlete who could set their own would
 * be rewriting every percentage they are prescribed.
 *
 * `athlete_id` names *someone else* and the API authorizes it against the token,
 * so it is not the banned "actor id from the client" pattern.
 */

export async function fetchMaxes(athleteId: string) {
  return api.get<AthleteMax[]>(`/maxes?athlete_id=${athleteId}`);
}

/** Pins a coach override. `value: null` clears it and hands control back to the
 * derived number — distinct from not calling this at all. */
export async function setMaxOverride(
  athleteId: string,
  exerciseId: string,
  value: number | null,
) {
  return api.patch<AthleteMax>(`/maxes/${exerciseId}`, {
    athlete_id: athleteId,
    override_value: value,
  });
}

/** Recomputes derived maxes from logged sets.
 *
 * Deliberately an action the coach takes rather than something that happens on
 * every logged set: a max that moved constantly would re-scale an athlete's
 * Wednesday because their Monday was strong.
 */
export async function refreshMaxes(athleteId: string, exerciseId?: string) {
  return api.post<{ refreshed: number; maxes: AthleteMax[] }>("/maxes/refresh", {
    athlete_id: athleteId,
    ...(exerciseId ? { exercise_id: exerciseId } : {}),
  });
}
