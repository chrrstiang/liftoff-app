import { api } from "@/lib/api/client";
import type { AthleteProfileView, UserProfileEnriched } from "@/types";

/** One athlete's profile, in the flat shape the roster and program screens render.
 *
 * ⚠️ **This no longer reads `coach_athletes_view`, and the change is a fix.** That
 * view joins through `coach_athlete_relationships`, and the old call ended in
 * `.single()` — so an athlete with **no coach** matched zero rows and `.single()`
 * errored. The Program tab points at the signed-in user's own id, which means every
 * athlete without a coach hit an error on their own program screen.
 *
 * `GET /athlete/profile/:id` has no such dependency: it reads the athlete and their
 * reference data, so it works for a coachless athlete and for a coach viewing
 * someone on their roster alike. `coach_id` is therefore no longer part of the
 * response — nothing rendered it.
 */
export async function fetchAthleteProfile(
  athleteId: string,
): Promise<Omit<AthleteProfileView, "coach_id">> {
  const profile = await api.get<{
    id: string;
    users: { first_name: string; last_name: string; username: string } | null;
    federations: { code: string | null } | null;
    divisions: { name: string | null } | null;
    weight_classes: { name: string | null } | null;
  }>(`/athlete/profile/${athleteId}`);

  // The endpoint returns relations as nested objects; these screens want it flat.
  // Left joins report null relations rather than objects full of nulls, hence the
  // optional chaining rather than a default-object spread.
  return {
    athlete_id: profile.id,
    first_name: profile.users?.first_name ?? "",
    last_name: profile.users?.last_name ?? "",
    username: profile.users?.username ?? "",
    // Not exposed by the public-profile allowlist, and nothing renders it here.
    avatar_url: null,
    federation_code: profile.federations?.code ?? null,
    division_name: profile.divisions?.name ?? null,
    weight_class_name: profile.weight_classes?.name ?? null,
  };
}

/** Athlete search for the invite flow.
 *
 * `coachId` is gone, and so is every bit of the old client-side filtering. What
 * that filtering did — or rather failed to do — is worth remembering:
 *
 *  - it fetched the already-invited ids, then excluded on `user.id`, but the view's
 *    identity column is `athlete_id` and there is no `id`, so it compared against
 *    `undefined` and excluded **nobody**
 *  - it asked for 50 rows to return 20, because exclusion happened after the fetch
 *  - the search term went into a PostgREST `.or()` expression, where `,` and `(`
 *    change the filter's meaning rather than being matched literally
 *
 * All three are now the server's problem, expressed as one parameterised query.
 */
export async function searchAthletes(query: string) {
  const term = query.trim();
  if (!term) return [];

  return api.get<UserProfileEnriched[]>(
    `/athlete/search?q=${encodeURIComponent(term)}`,
  );
}
