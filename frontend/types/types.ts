export interface Exercise {
  id: string;
  name: string;
  description?: string;
  video_url?: string;
}

export interface Set {
  id: string;
  set_number: number;
  prescribed_reps: number | null;
  prescribed_intensity: number | null;
  suggested_load_min: number | null;
  suggested_load_max: number | null;
  actual_load: number | null;
  actual_intensity: number | null;
  is_completed: boolean;
}

export interface WorkoutExercise {
  id: string;
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
  athlete_id: string;
  created_at: string;
  updated_at: string;
  workout_exercises: WorkoutExercise[];
}
