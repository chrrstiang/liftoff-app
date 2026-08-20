import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from 'src/db/db.module';
import { coachAthleteRelationships, sets, workoutExercises, workouts } from 'src/db/schema';

/** The ownership walk for programming.
 *
 * ⚠️ **There is no RLS behind any of this.** Every rule in this file is the entire
 * authorization for a programming operation. On Supabase, `workouts`, `sets` and
 * `workout_exercises` were readable and writable by any authenticated client, so
 * anyone could rewrite anyone's training log. This is what replaces that.
 *
 * The walk is always `sets → workout_exercises → workouts`, and it is always a
 * single joined query rather than three sequential lookups. That is deliberate:
 * fetching the set, then its exercise, then its workout leaves three windows in
 * which a caller sees a row they are not entitled to, and it is easy to check the
 * wrong link in the chain. One query cannot be half-authorized.
 */

/** Who a workout belongs to. `athleteId` is null for a template. */
export interface WorkoutOwners {
  id: string;
  athleteId: string | null;
  coachId: string;
}

/** True when the caller is the coach in an **active** relationship with the athlete.
 *
 * `pending` deliberately does not count. A pending row is an unaccepted invite, and
 * treating it as access would mean sending an invite is enough to read someone's
 * training — which is the invite exploit wearing a different hat.
 */
export async function isActiveCoachOf(
  db: Database,
  coachId: string,
  athleteId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: coachAthleteRelationships.id })
    .from(coachAthleteRelationships)
    .where(
      and(
        eq(coachAthleteRelationships.coachId, coachId),
        eq(coachAthleteRelationships.athleteId, athleteId),
        eq(coachAthleteRelationships.status, 'active'),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** Loads a workout the caller may **read**: their own, or one they coach.
 *
 * A caller with no claim on the workout gets a 404, not a 403 — the same choice
 * made for coach requests and conversations. A 403 confirms the id names a real
 * workout, which combined with enumerable ids leaks who is training whom.
 */
export async function loadReadableWorkout(
  db: Database,
  workoutId: string,
  callerId: string,
): Promise<WorkoutOwners> {
  const [workout] = await db
    .select({
      id: workouts.id,
      athleteId: workouts.athleteId,
      coachId: workouts.coachId,
    })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1);

  if (!workout || !(workout.athleteId === callerId || workout.coachId === callerId)) {
    throw new NotFoundException(`Workout with ID ${workoutId} could not be found`);
  }

  return workout;
}

/** Loads a workout whose **structure** the caller may change — add an exercise,
 * change the prescription. That is the coach's job, never the athlete's: an
 * athlete who can rewrite `prescribed_reps` can rewrite the program they were
 * given, and the record of what was actually asked of them is gone.
 *
 * Read access is checked first so that a stranger still gets a 404 rather than a
 * 403 revealing the workout exists.
 */
export async function loadProgrammableWorkout(
  db: Database,
  workoutId: string,
  callerId: string,
): Promise<WorkoutOwners> {
  const workout = await loadReadableWorkout(db, workoutId, callerId);

  if (workout.coachId !== callerId) {
    throw new ForbiddenException('Only the coach who owns this workout can change it');
  }

  return workout;
}

/** Resolves a set to the workout that contains it, in one query.
 *
 * Returns null rather than throwing so callers choose the status code — every
 * current caller wants a 404 naming the set, not the workout.
 */
export async function loadSetOwners(db: Database, setId: string): Promise<WorkoutOwners | null> {
  const [row] = await db
    .select({
      id: workouts.id,
      athleteId: workouts.athleteId,
      coachId: workouts.coachId,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(eq(sets.id, setId))
    .limit(1);

  return row ?? null;
}

/** Whether the caller is the one who *performs* this workout, which is who may
 * write `actual_load` / `actual_intensity` / `is_completed`.
 *
 * For an assigned workout that is the athlete alone — a coach who could edit those
 * columns could falsify what their athlete actually lifted, and the log stops being
 * evidence of anything. For a template (`athlete_id` is null) nobody performs it,
 * so the owning coach may fill the fields in while building it.
 */
export function isPerformer(workout: WorkoutOwners, callerId: string): boolean {
  return workout.athleteId === null ? workout.coachId === callerId : workout.athleteId === callerId;
}
