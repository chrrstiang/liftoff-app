import { supabase } from "@/lib/supabase";
import { Set, WorkoutExercise } from "@/types/types";

export async function fetchWorkoutById(workoutId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select(
      `
      *,
      workout_exercises (
        id,
        order,
        notes,
        exercise:exercises (
          id,
          name
        ),
        sets (
          id,
          set_number,
          prescribed_reps,
          prescribed_intensity,
          suggested_load_min,
          suggested_load_max,
          actual_load,
          actual_intensity,
          is_completed
        )
      )
    `,
    )
    .eq("id", workoutId)
    .single();

  // sort by order and set number
  data.workout_exercises.sort(
    (a: WorkoutExercise, b: WorkoutExercise) => a.order - b.order,
  );
  data.workout_exercises.forEach((workoutExercise: WorkoutExercise) => {
    workoutExercise.sets.sort((a: Set, b: Set) => a.set_number - b.set_number);
  });

  if (error) {
    console.log("failed to fetch workout", error);
    throw new Error("failed to fetch workout", error);
  }

  if (!data) {
    console.log("No workout was found");
    throw new Error("No workout was found");
  }

  return data;
}

export async function fetchAthleteWorkouts(athleteId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, name, date")
    .eq("athlete_id", athleteId)
    .order("date", { ascending: true });

  if (error) throw error;
  return data;
}

export async function updateSet(updatedSet: Set) {
  const { data, error } = await supabase
    .from("sets")
    .update({
      actual_load: updatedSet.actual_load,
      actual_intensity: updatedSet.actual_intensity,
      is_completed: updatedSet.is_completed,
    })
    .eq("id", updatedSet.id)
    .select()
    .single();

  if (error) {
    console.error("Error updating set:", error);
    throw new Error("Failed to update set: " + error);
  }

  if (!data) {
    console.error("Data is empty, update failed");
    throw new Error("Failed to update set: No data returned");
  }

  return data;
}

export async function createWorkout(workout: {
  name: string;
  date: string;
  athlete_id: string;
  coach_id: string;
}) {
  const { data, error } = await supabase.from("workouts").insert(workout);

  if (error) throw error;

  return data;
}

// implement this
export async function fetchTemplateWorkouts(coachId: string) {
  const { data, error } = await supabase
    .from("workout_templates")
    .select("*")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data;
}
