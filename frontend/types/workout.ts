/** Programming: workouts, exercises, sets, and the template shapes. */

export interface Exercise {
  id: string;
  name: string;
}

export interface Set {
  id: string;
  set_number: number;
  prescribed_reps: number | null;
  /** text in the schema, unlike actual_intensity which is a double. */
  prescribed_intensity: string | null;
  suggested_load_min?: number | null;
  suggested_load_max?: number | null;
  actual_load?: number | null;
  actual_intensity?: number | null;
  is_completed?: boolean;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  order: number;
  notes: string | null;
  exercise: Exercise;
  sets: Set[];
}

export interface Workout {
  id: string;
  name: string;
  date: string;
  notes: string | null;
  /** Null on a template — nobody is assigned it. Anything keyed on the performing
   * athlete (exercise history, for one) has to handle that rather than assume. */
  athlete_id?: string | null;
  created_at: string;
  workout_exercises: WorkoutExercise[];
}

/** One past workout as it appears in the history list.
 *
 * The three counts come from the API rather than being derived here: the list
 * endpoint does not send the nested exercises and sets, precisely so that a page
 * of twenty sessions is not a page of several hundred rows. */
export interface WorkoutHistoryEntry {
  id: string;
  name: string;
  date: string;
  notes: string | null;
  exercise_count: number;
  set_count: number;
  completed_set_count: number;
}

/** A page of history. `has_more` is the server's answer, not a length comparison —
 * the last page is full as often as not. */
export interface WorkoutHistoryPage {
  workouts: WorkoutHistoryEntry[];
  limit: number;
  offset: number;
  has_more: boolean;
}

/** Everything logged for one exercise in one session. */
export interface ExerciseHistorySession {
  workout_id: string;
  workout_name: string;
  date: string;
  sets: Set[];
}

/** Paged over **sessions**, not sets, so the oldest session on a page is whole. */
export interface ExerciseHistoryPage {
  sessions: ExerciseHistorySession[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SetTemplate {
  id: string;
  set_number: number;
  prescribed_reps: number | null;
  prescribed_intensity: string | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  notes: string | null;
  workout_exercises: WorkoutExercise[];
}

export interface ExerciseTemplate {
  id: string;
  name: string;
  templates: {
    id: string;
    name: string;
    sets: SetTemplate[];
  }[];
}

/** Form shapes used while building an exercise, before it is persisted. */
export type ExerciseFormSet = {
  prescribed_reps: number | null;
  prescribed_intensity: string | null;
  suggested_load_min?: number | null;
  suggested_load_max?: number | null;
  set_number?: number;
};

export type ExerciseFormData = {
  name: string;
  workout_id: string;
  created_by: string;
  order: number;
  sets: ExerciseFormSet[];
};
