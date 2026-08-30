import { api } from "@/lib/api/client";
import type { ExerciseFormSet, Set, Workout, WorkoutTemplate } from "@/types";

/** Workouts, sets and the programming flow.
 *
 * All the sorting that used to happen here is gone: the API orders
 * `workout_exercises` by `order` and sets by `set_number` in SQL. The old version
 * sorted in JavaScript *after* the fetch and, worse, sorted **before** checking
 * `error` — so a failed request crashed on `data.workout_exercises` being
 * undefined rather than surfacing the error.
 */

export async function fetchWorkoutById(workoutId: string) {
  return api.get<Workout>(`/workouts/${workoutId}`);
}

export async function fetchAthleteWorkouts(athleteId: string) {
  return api.get<{ id: string; name: string; date: string }[]>(
    `/workouts?athlete_id=${athleteId}`,
  );
}

/** Logs what was actually lifted on one set.
 *
 * Sends only the three `actual_*`/`is_completed` columns. The prescription is the
 * coach's and the API rejects any attempt to patch it — which is a real constraint
 * now, not a convention: this used to be an unguarded `update` on `sets` with the
 * anon key, so any user could rewrite any athlete's log.
 */
export async function updateSet(updatedSet: Set) {
  return api.patch<Set>(`/sets/${updatedSet.id}`, {
    actual_load: updatedSet.actual_load,
    actual_intensity: updatedSet.actual_intensity,
    is_completed: updatedSet.is_completed,
  });
}

export interface CreateWorkoutBody {
  name: string;
  date: string;
  /** Null creates a template belonging to the calling coach. */
  athlete_id: string | null;
  notes?: string;
  exercises: {
    /** The library exercise's id. */
    id: string;
    name: string;
    order: number;
    notes?: string;
    sets: ExerciseFormSet[];
  }[];
}

/** Creates a workout with all its exercises and sets in **one** request.
 *
 * This was 1 + 2N requests with no transaction, so a failure partway left a
 * half-built workout the athlete could open and start logging against — and no way
 * to tell that from a workout the coach meant to leave short.
 *
 * `coach_id` is deliberately not sent. It used to come from the client, which meant
 * a workout could be attributed to any coach; the API takes it from the token and
 * **rejects the field outright**, so adding it back here is a 400 rather than a
 * silent regression.
 *
 * `is_template` is not sent either — the API derives it from `athlete_id` being
 * null. Sending both admits `is_template: true` *with* an athlete, which has no
 * coherent meaning.
 */
export async function createWorkout(workout: CreateWorkoutBody) {
  return api.post<{ id: string; message: string }>("/workouts", {
    name: workout.name,
    date: workout.date,
    athlete_id: workout.athlete_id,
    notes: workout.notes,
    exercises: workout.exercises.map((exercise) => ({
      exercise_id: exercise.id,
      display_name: exercise.name,
      order: exercise.order,
      notes: exercise.notes,
      sets: exercise.sets.map((set) => ({
        set_number: set.set_number,
        prescribed_reps: set.prescribed_reps,
        prescribed_intensity: set.prescribed_intensity ?? undefined,
        suggested_load_min: set.suggested_load_min ?? undefined,
        suggested_load_max: set.suggested_load_max ?? undefined,
      })),
    })),
  });
}

/** The calling coach's template library.
 *
 * `userId` is gone — the API scopes it to the token. Note that this list was
 * **always empty** before, for everyone: it filtered `is_template = true`, but
 * nothing ever wrote that column, so it was NULL and `= true` does not match NULL.
 */
export async function fetchTemplateWorkouts() {
  return api.get<WorkoutTemplate[]>("/workouts/templates");
}

/** Adds one exercise to an existing workout.
 *
 * Pass `exercise_id` for something already in the library, or `name` to create the
 * library entry and attach it in the same request — exactly one of the two.
 */
export async function addWorkoutExercise(
  workoutId: string,
  exercise: {
    exercise_id?: string;
    name?: string;
    display_name?: string;
    order?: number;
    notes?: string;
    sets: ExerciseFormSet[];
  },
) {
  return api.post<{ id: string; exercise_id: string; order: number }>(
    `/workouts/${workoutId}/exercises`,
    {
      exercise_id: exercise.exercise_id,
      name: exercise.name,
      display_name: exercise.display_name,
      order: exercise.order,
      notes: exercise.notes,
      sets: exercise.sets.map((set) => ({
        set_number: set.set_number,
        prescribed_reps: set.prescribed_reps,
        prescribed_intensity: set.prescribed_intensity ?? undefined,
        suggested_load_min: set.suggested_load_min ?? undefined,
        suggested_load_max: set.suggested_load_max ?? undefined,
      })),
    },
  );
}

export async function deleteWorkout(workoutId: string) {
  await api.delete(`/workouts/${workoutId}`);
}
