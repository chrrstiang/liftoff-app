/** Estimating a one-rep max from a logged set.
 *
 * This is the whole numeric core of derived maxes, kept as pure functions with no
 * database access so it can be tested directly rather than through a service.
 *
 * See docs/MAXES-DESIGN.md section 4.
 */

/** A logged set, reduced to the three columns an estimate needs. */
export interface LoggedSet {
  id: string;
  actual_load: number | null;
  prescribed_reps: number | null;
  actual_intensity: number | null;
  created_at: Date | string;
}

/** How far back a set may be and still count toward a max. */
export const MAX_WINDOW_DAYS = 28;

/** RPE is a 1-10 scale. Anything outside it is a data-entry error rather than a
 * very easy or impossible set, and estimating from it would produce a number that
 * looks authoritative and is not. */
const MIN_RPE = 1;
const MAX_RPE = 10;

/** Epley's coefficient. Weakest at high reps; powerlifting work is mostly at or
 * below eight, so it is fine here, and it needs no lookup table for anyone to
 * maintain or mistype. */
const EPLEY_DIVISOR = 30;

/** Estimates a one-rep max from load, reps and RPE.
 *
 * RPE converts to reps-in-reserve — RPE 8 means two more were available — so a
 * triple at RPE 8 is five reps to failure:
 *
 *     rtf  = reps + (10 - rpe)
 *     e1RM = load * (1 + rtf / 30)
 *
 * Returns null rather than a number whenever the inputs cannot support an
 * estimate. **A set with no logged RPE is the common case**, not an edge case:
 * `actual_intensity` is nullable and plenty of sets will never have one. Treating
 * those as taken to failure would inflate every max in the app, so they are
 * excluded instead.
 */
export function estimateOneRepMax(
  load: number | null,
  reps: number | null,
  rpe: number | null,
): number | null {
  if (load === null || reps === null || rpe === null) return null;
  if (!Number.isFinite(load) || !Number.isFinite(reps) || !Number.isFinite(rpe)) return null;

  // A zero or negative load estimates nothing. Zero reps is a set that did not
  // happen; the row exists because it was prescribed, not because it was lifted.
  if (load <= 0 || reps <= 0) return null;
  if (rpe < MIN_RPE || rpe > MAX_RPE) return null;

  const repsToFailure = reps + (MAX_RPE - rpe);

  return load * (1 + repsToFailure / EPLEY_DIVISOR);
}

export interface MaxEstimate {
  value: number;
  /** The set that produced it, so the number can be argued with rather than just
   * believed. */
  fromSetId: string;
}

/** Picks the max an athlete's recent work supports: the **highest** estimate among
 * sets logged within the window.
 *
 * Highest rather than most recent, deliberately. A max is a capability, and taking
 * the latest set would drop it after every deload — the athlete would be
 * prescribed lighter work *because* they had a light week, which compounds.
 *
 * Returns null when no set in the window can be estimated from, which is the
 * normal state for an exercise the athlete has not logged RPE work on yet.
 */
export function selectMaxEstimate(
  loggedSets: LoggedSet[],
  now: Date = new Date(),
  windowDays: number = MAX_WINDOW_DAYS,
): MaxEstimate | null {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let best: MaxEstimate | null = null;

  for (const set of loggedSets) {
    const loggedAt = new Date(set.created_at).getTime();
    if (!Number.isFinite(loggedAt) || loggedAt < cutoff) continue;

    const estimate = estimateOneRepMax(set.actual_load, set.prescribed_reps, set.actual_intensity);
    if (estimate === null) continue;

    if (best === null || estimate > best.value) {
      best = { value: estimate, fromSetId: set.id };
    }
  }

  return best;
}

/** What a percentage prescription actually resolves to.
 *
 * Returns null when there is no max yet, and the client renders that as
 * "75% — no max yet" rather than an error. Prescribing percentages before there is
 * data is the normal first block, not a mistake to reject.
 */
export function resolvePrescribedLoad(
  percent: number | null,
  effectiveMax: number | null,
): number | null {
  if (percent === null || effectiveMax === null) return null;
  if (!Number.isFinite(percent) || !Number.isFinite(effectiveMax)) return null;

  return (percent / 100) * effectiveMax;
}

/** `override_value ?? computed_value`, in one place so the precedence cannot drift
 * between the read path and the refresh path.
 *
 * An override is a **pin, not a seed**: it keeps winning until the coach clears
 * it. A coach who knows their athlete's comp squat is 180 should not be overruled
 * by one cautious session.
 */
export function effectiveMax(row: {
  override_value: number | null;
  computed_value: number | null;
}): number | null {
  return row.override_value ?? row.computed_value;
}
