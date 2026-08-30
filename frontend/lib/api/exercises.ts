import { api } from "@/lib/api/client";
import type { ExerciseFormData, ExerciseTemplate } from "@/types";
import { addWorkoutExercise } from "@/lib/api/workouts";

/** The exercise library.
 *
 * ⚠️ **`createExercise` used to swallow its own failures.** Each of its three
 * inserts logged the error and `return`ed `undefined` — so a failure looked
 * identical to success to the caller, and the optimistic cache update was never
 * rolled back. The exercise simply vanished on the next refetch. Errors now throw,
 * which is what the mutation's `onError` was always written to expect.
 */

/** Creates an exercise and attaches it to a workout, with its sets.
 *
 * Three unguarded client inserts became one request. That matters beyond tidiness:
 * the writes had no transaction, so a failure on the sets left an exercise attached
 * to the workout with no sets under it — a row the UI renders as an empty exercise
 * that cannot be completed.
 */
export async function createExercise(exerciseData: ExerciseFormData) {
  return addWorkoutExercise(exerciseData.workout_id, {
    name: exerciseData.name,
    order: exerciseData.order,
    sets: exerciseData.sets,
  });
}

/** The caller's exercise library, for the workout builder's picker. */
export async function fetchExercises() {
  return api.get<{ id: string; name: string; created_at: string }[]>("/exercises");
}

/** The caller's exercises that have at least one set template, grouped by exercise.
 *
 * `coachId` is gone — the API scopes this to the token. It also now scopes the
 * *templates* to the caller, which the old query did not: it filtered exercises by
 * `created_by` but left the nested templates unfiltered, so a template another
 * coach had authored against a shared exercise would have leaked in.
 */
export async function fetchExerciseTemplates() {
  return api.get<ExerciseTemplate[]>("/exercises/templates");
}
