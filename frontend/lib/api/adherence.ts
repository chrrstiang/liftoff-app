import { api } from "@/lib/api/client";
import type { AdherenceRow } from "@/types";

/** Who on the calling coach's roster is actually doing the work.
 *
 * No id is sent: the roster is derived from the token server-side, so there is
 * nothing here for a caller to tamper with. An athlete calling it gets an empty
 * list rather than an error — they have no roster, which is a true and
 * uninteresting answer rather than a permission failure.
 */
export async function fetchAdherence(days?: number) {
  const query = days ? `?days=${days}` : "";
  return api.get<AdherenceRow[]>(`/adherence${query}`);
}
