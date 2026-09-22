import { api } from "@/lib/api/client";
import type {
  ExerciseFormSet,
  ExerciseHistoryPage,
  Set,
  Workout,
  WorkoutHistoryPage,
  WorkoutTemplate,
} from "@/types";
import { format, startOfToday } from "date-fns";

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

/** The page window both history routes take.
 *
 * `before` is exclusive and defaults to **local** today. That default lives here
 * rather than on the server on purpose: "past" is a question about the lifter's
 * calendar, and the API's own idea of today is UTC, which files an evening session
 * on the wrong day for anyone west of Greenwich. Every caller therefore gets the
 * device's answer without having to remember to send one.
 */
export interface HistoryWindow {
  athleteId: string;
  before?: string;
  limit?: number;
  offset?: number;
}

/** Built by hand rather than with `URLSearchParams`, whose React Native polyfill
 * does not implement all of the web API. */
function historyQuery({ athleteId, before, limit, offset }: HistoryWindow) {
  const parts = [
    `athlete_id=${encodeURIComponent(athleteId)}`,
    `before=${before ?? format(startOfToday(), "yyyy-MM-dd")}`,
  ];

  if (limit !== undefined) parts.push(`limit=${limit}`);
  if (offset !== undefined) parts.push(`offset=${offset}`);

  return parts.join("&");
}

/** One page of an athlete's past workouts, newest first.
 *
 * Separate from `fetchAthleteWorkouts`, which returns every assigned workout in
 * ascending order and is what home reads to find the *next* session. Until this
 * existed, nothing read a workout back after its date had passed — everything a
 * lifter had logged became unreachable the following day.
 *
 * `athleteId` names someone else when a coach calls it; the API authorizes it
 * against the token and 404s a caller with no claim.
 */
export async function fetchWorkoutHistory(window: HistoryWindow) {
  return api.get<WorkoutHistoryPage>(`/workouts/history?${historyQuery(window)}`);
}

/** Every set an athlete has logged for one exercise, grouped by session.
 *
 * An exercise the athlete has never trained comes back with no sessions rather
 * than an error, so a caller does not need to know what is in the library.
 */
export async function fetchExerciseHistory(
  exerciseId: string,
  window: HistoryWindow,
) {
  return api.get<ExerciseHistoryPage>(
    `/exercises/${exerciseId}/history?${historyQuery(window)}`,
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
        // Omitted rather than sent as null: ValidationPipe runs with
        // forbidNonWhitelisted, and the DTO field is optional, so `undefined`
        // means "no percentage" while an explicit null would be a 400.
        prescribed_percent: set.prescribed_percent ?? undefined,
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

/** Copies one workout onto several athletes at once.
 *
 * The 17-athletes-per-coach bottleneck: building the same session seventeen
 * times is what sends a coach back to the spreadsheet.
 *
 * ⚠️ `date` is a **date-only** `YYYY-MM-DD` built from local calendar fields, not
 * a `toISOString()`. Which day a session belongs to is a question about the
 * lifter's calendar; sending a UTC timestamp files an evening assignment on the
 * following day for anyone west of Greenwich. `createWorkout` above still sends a
 * full ISO string and has exactly that bug.
 */
export async function assignWorkout(
  workoutId: string,
  athleteIds: string[],
  date: string,
) {
  return api.post<{ assigned: number; workout_ids: string[] }>(
    `/workouts/${workoutId}/assign`,
    { athlete_ids: athleteIds, date },
  );
}

/** A `Date` as the local `YYYY-MM-DD` it represents on the user's calendar.
 *
 * `toISOString()` converts to UTC first, so 9pm on the 5th in New York becomes
 * the 6th. Reading the local getters avoids the conversion entirely.
 */
export function toLocalDateString(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
