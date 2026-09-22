/** An athlete's max for one exercise — what percentage prescription resolves
 * against.
 *
 * Keyed per exercise rather than per parent lift, because each variation has its
 * own difficulty and therefore its own max: a tempo squat at RPE 7 is not a comp
 * squat at RPE 7. See `docs/MAXES-DESIGN.md`.
 */
export interface AthleteMax {
  exercise_id: string;
  exercise_name: string;
  /** `override_value ?? computed_value` — what prescription actually uses. The
   * server resolves the precedence so the client never reimplements it. */
  effective_value: number | null;
  /** The coach's pinned number. A pin, not a seed: it wins until cleared. */
  override_value: number | null;
  /** Last value derived from logged sets. Only moves on an explicit refresh. */
  computed_value: number | null;
  computed_at: string | null;
  /** The set the computed value came from, so a number can be argued with rather
   * than only believed. */
  computed_from: string | null;
}
