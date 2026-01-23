export interface Exercise {
  id: string;
  name: string;
  order?: number;
}

export interface Set {
  id: string;
  set_number: number;
  prescribed_reps: number | null;
  prescribed_intensity: string | null;
  suggested_load_min: number | null;
  suggested_load_max: number | null;
  actual_load?: number | null;
  actual_intensity?: number | null;
  is_completed?: boolean;
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
  athlete_id?: string;
  created_at: string;
  workout_exercises?: WorkoutExercise[];
}

export type AthleteProfileView = {
  coach_id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
  federation_code: string | null;
  division_name: string | null;
  weight_class_name: string | null;
};

export type ExerciseFormSet = {
  prescribed_reps: number | null;
  prescribed_intensity: string | null;
  suggested_load_min: number | null;
  suggested_load_max: number | null;
  set_number?: number;
};
export type ExerciseFormData = {
  name: string;
  workout_id: string;
  created_by: string;
  order: number;
  sets: ExerciseFormSet[];
};

export type CoachRequest = {
  id: string;
  created_at: string;
  coach_id: string;
  athlete_id: string;
  status: string;
  coach_username: string;
  coach_avatar_url: string | null;
};

export type UserProfileEnriched = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
  federation_id: string | null;
  federation_code: string | null;
  weight_class_id: string | null;
  weight_class_name: string | null;
  division_id: string | null;
  division_name: string | null;
};

export type UserConversation = {
  conversation_id: string;
  name: string | null;
  avatar_url: string | null;
  updated_at: string;
  user_id: string;
  last_read_at: string | null;
  last_message_content: string | null;
  last_message_sent_at: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
  other_user_id: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  content: string;
  sender_id: string;
  sender_avatar_url: string | null;
  sender_first_name: string;
  sender_last_name: string;
  sent_at: string;
  message_type: "text" | "image" | "video" | "file";
  media_url: string | null;
};
