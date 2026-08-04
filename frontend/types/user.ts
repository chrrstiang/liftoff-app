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
