import { api } from "@/lib/api/client";
import type {
  AthleteCompeting,
  AthleteCompetingPatch,
  AthleteProfileView,
  UserProfileEnriched,
} from "@/types";

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

/** An athlete's reference-data *ids*, for seeding the edit form.
 *
 * `fetchAthleteProfile` above returns the resolved *names* (`federation_code`,
 * `weight_class_name`) because that is what a read-only screen renders. An edit
 * form needs the ids instead, so the pickers can mark the current row as selected
 * and so the PATCH can send back something unambiguous — a weight-class name is
 * not unique across federations and genders.
 *
 * The `?data=` list is deliberately narrow: those three columns and nothing else.
 * All three are already on `VALID_ATHLETES_COLUMNS_QUERIES`, so this needed no
 * widening of the allowlist that governs what this endpoint exposes.
 */
export async function fetchAthleteCompeting(
  athleteId: string,
): Promise<AthleteCompeting> {
  return api.get<AthleteCompeting>(
    `/athlete/profile/${athleteId}?data=federation_id,division_id,weight_class_id`,
  );
}

/** Updates the caller's own competing details.
 *
 * ⚠️ **No id argument.** `PATCH /athlete/profile` takes none — not in the path and
 * not in the body — because a user may only update their own row, and the caller
 * comes from the verified token. Same rule as `updateUserProfile` and
 * `updateUserAvatar`.
 *
 * The API validates the three columns against each other on the **merged** row, so
 * a patch that changes federation must carry the matching division and weight
 * class (or clear them with `null`) or it is a 400.
 */
export async function updateAthleteProfile(
  patch: AthleteCompetingPatch,
): Promise<void> {
  await api.patch("/athlete/profile", patch);
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
