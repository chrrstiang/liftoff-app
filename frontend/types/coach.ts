/** Coach-side shapes: the roster view and the invite flow. */

/** A row from `coach_athletes_view` — the coach's roster. */
export type AthleteProfileView = {
  coach_id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
  federation_code: string | null;
  division_name: string | null;
  weight_class_name: string | null;
};

/** A row from `user_coach_requests_view` — a pending invite, from the athlete's side.
 *
 * `status` is the `coach_request_status` enum: 'pending' | 'accepted' | 'rejected'.
 * Typed as string because the client only ever compares it.
 */
export type CoachRequest = {
  id: string;
  created_at: string;
  coach_id: string;
  athlete_id: string;
  status: string;
  coach_username: string;
  coach_avatar_url: string | null;
};
