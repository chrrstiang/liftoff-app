/** User profile shapes. */

/** The POST /users/profile request body.
 *
 * Mirrors CreateUserDto on the backend. The backend runs with
 * `forbidNonWhitelisted: true`, so an extra field here is a 400 rather than
 * something ignored — keep this in step with the DTO.
 *
 * `date_of_birth` is a Date because that is what the picker holds; JSON.stringify
 * serialises it to the ISO 8601 string the DTO validates.
 */
export interface Profile {
  first_name: string;
  last_name: string;
  username: string;
  gender: string;
  date_of_birth: Date;
  /** uuid — see types/reference.ts on why these are strings, not numbers. */
  federation_id?: string;
  division_id?: string;
  weight_class_id?: string;
  is_athlete: boolean;
  is_coach: boolean;
  biography?: string;
  years_of_experience?: number;
}

/** The `PATCH /users/profile` request body — the editable `users` columns.
 *
 * Mirrors `UpdateUserDto`, which is `PartialType(CreateUserDto)` plus
 * `avatar_url`. Every field is optional there and every field is optional here,
 * and that is load-bearing in a way the create shape is not:
 *
 * ⚠️ **Send only the fields that actually changed.** `@IsUnique('users',
 * 'username')` on the backend matches the caller's *own* row, so re-sending the
 * username you already have is rejected as a collision with yourself. That is a
 * recorded known limitation (`docs/ARCHITECTURE.md` §7) rather than a bug to fix
 * in passing, and "the client only sends changed fields" is the reason nothing
 * hits it. `edit-profile.tsx` diffs against the loaded profile for exactly this
 * reason — a screen that PATCHed the whole form would 400 on every save.
 *
 * `avatar_url` is absent because `lib/api/storage.ts` owns that one field, and it
 * is a storage path rather than anything the user types.
 */
export interface ProfilePatch {
  first_name?: string;
  last_name?: string;
  username?: string;
  gender?: string;
}

/** The caller's own reference-data selections on the `athletes` row.
 *
 * Read via `GET /athlete/profile/:id?data=federation_id,division_id,weight_class_id`
 * — those three are on `VALID_ATHLETES_COLUMNS_QUERIES`, so no allowlist change
 * was needed to fetch them.
 */
export interface AthleteCompeting {
  federation_id: string | null;
  division_id: string | null;
  weight_class_id: string | null;
}

/** The `PATCH /athlete/profile` request body.
 *
 * `null` clears a column and an absent key leaves it alone — the distinction
 * matters because changing gender invalidates a weight class, and the client needs
 * to be able to say "I no longer have one".
 */
export interface AthleteCompetingPatch {
  federation_id?: string | null;
  division_id?: string | null;
  weight_class_id?: string | null;
}

/** A row from `user_profiles_enriched_view`.
 *
 * ⚠️ The identity column is `athlete_id`. There is **no `id`** — which is why the
 * exclusion filter in lib/api/athlete.ts compared against `undefined` and never
 * removed already-invited athletes from search results.
 */
export type UserProfileEnriched = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
  federation_id: string | null;
  federation_code: string | null;
  weight_class_id: string | null;
  weight_class_name: string | null;
  division_id: string | null;
  division_name: string | null;
};
