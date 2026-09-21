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

/** Asserts the caller may read an athlete's training log — their own, or that of
 * an athlete on their roster.
 *
 * This is the whole authorization for every history read: both history routes take
 * an `athlete_id` and nothing downstream of this re-checks it, so each query is
 * scoped by the id this function has already vouched for.
 *
 * A caller with no claim gets a 404 naming the athlete, not a 403. Athlete ids are
 * handed out by `/athlete/search`, so a 403 here would answer "is this user
 * training with me?" for any id the caller cares to try.
 */
export async function assertReadableAthlete(
  db: Database,
  athleteId: string,
  callerId: string,
): Promise<void> {
  if (athleteId === callerId) return;
  if (await isActiveCoachOf(db, callerId, athleteId)) return;

  throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
}

/** The row filter for every history read: which of an athlete's workouts this
 * caller is allowed to see.
 *
 * ⚠️ **Deliberately narrow, and an open product question.** An athlete may have
 * more than one coach, so "may read this athlete" and "may read this workout" are
 * two different questions:
 *
 *  - The **athlete** sees every workout assigned to them. All of it is theirs.
 *  - A **coach** sees only the workouts they authored (`coach_id = callerId`),
 *    which is exactly the rule `loadReadableWorkout` already enforces for a single
 *    workout. With coaches A and B both coaching athlete X, A cannot read the
 *    sessions B wrote.
 *
 * The broader rule — any active coach of an athlete sees that athlete's whole
 * history — is more useful and is what a coach would probably expect. It is not
 * implemented here because it would newly expose one coach's programming to
 * another, and that is a product decision with privacy consequences rather than an
 * implementation detail. There is no RLS, so this filter is the entire boundary.
 *
 * If that decision is reversed, this function is the only thing that changes —
 * which is why it exists as a function rather than as a `where` clause repeated in
 * each query. `programming-access.spec.ts` pins the narrow behaviour, so the
 * reversal shows up as a failing test to be changed on purpose.
 *
 * Note this is a *filter*, not a gate: it decides which rows come back, not
 * whether the request is allowed at all. `assertReadableAthlete` still runs first,
 * so a caller with no claim on the athlete gets a 404 rather than an empty list.
 */
export function historyVisibilityFilter(athleteId: string, callerId: string) {
  return and(
    eq(workouts.athleteId, athleteId),
    // `and` drops an undefined term, so this is "no extra restriction" when the
    // caller is the athlete themselves.
    athleteId === callerId ? undefined : eq(workouts.coachId, callerId),
  );
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
