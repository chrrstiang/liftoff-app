/** One athlete's adherence over a window, from `GET /adherence`.
 *
 * Raw counts rather than a percentage: "8 of 12 sets" tells a coach something
 * "67%" does not, and anything that wants a percentage can divide.
 */
export interface AdherenceRow {
  athlete_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  workouts_assigned: number;
  workouts_started: number;
  sets_prescribed: number;
  sets_completed: number;
}
