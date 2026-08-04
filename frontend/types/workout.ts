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
  athlete_id?: string;
  created_at: string;
  workout_exercises: WorkoutExercise[];
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
