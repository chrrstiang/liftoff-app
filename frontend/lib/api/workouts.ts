import { supabase } from "@/lib/supabase";
import {
  ExerciseFormSet,
  Set,
  WorkoutExercise,
  WorkoutTemplate,
} from "@/types/types";

export async function fetchWorkoutById(workoutId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select(
      `
      *,
      workout_exercises (
        id,
        name:display_name,
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
  athlete_id: string | null;
  coach_id: string;
  exercises: {
    id: string;
    name: string;
    order: number;
    notes?: string;
    sets: ExerciseFormSet[];
  }[];
}) {
  console.log("💪 [API] Creating workout:", {
    name: workout.name,
    date: workout.date,
    athlete_id: workout.athlete_id,
    exercise_count: workout.exercises.length,
    is_template: workout.athlete_id === null,
  });

  // initialize new workout record
  const { data: newWorkout, error: workoutError } = await supabase
    .from("workouts")
    .insert({
      name: workout.name,
      date: workout.date,
      athlete_id: workout.athlete_id,
      coach_id: workout.coach_id,
    })
    .select()
    .single();

  if (workoutError) throw workoutError;

  console.log("💪 [API] Workout created successfully:", newWorkout.id);

  let curr;
  // create workout_exercise record for each exercise
  for (const exercise of workout.exercises) {
    curr = exercise;

    const { data: newWorkoutExercise, error: workoutExerciseError } =
      await supabase
        .from("workout_exercises")
        .insert({
          workout_id: newWorkout.id,
          exercise_id: curr.id,
          display_name: exercise.name,
          order: curr.order,
          notes: curr.notes,
        })
        .select()
        .single();

    if (workoutExerciseError) throw workoutExerciseError;

    const setsToInsert = exercise.sets.map((set) => ({
      ...set,
      workout_exercise_id: newWorkoutExercise.id,
    }));

    const { data: setRecords, error: setRecordError } = await supabase
      .from("sets")
      .insert(setsToInsert);

    if (setRecordError) throw setRecordError;
  }

  return newWorkout;
}

// used to fetch template workouts for workout creation
export async function fetchTemplateWorkouts(userId: string) {
  console.log("📋 [API] Fetching template workouts for coach:", userId);
  const { data, error } = await supabase
    .from("workouts")
    .select(
      `
      id,
      name,
      notes,
      workout_exercises (
      id,
      name:display_name,
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
          prescribed_intensity
        )
      )
    `,
    )
    .eq("coach_id", userId)
    .eq("is_template", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  console.log(
    "📋 [API] Template workouts fetched:",
    data?.length || 0,
    "workouts",
  );

  // sort workout_exercises by order
  data.forEach((workout) => {
    workout.workout_exercises = workout.workout_exercises.sort(
      (a, b) => a.order - b.order,
    );
  });

  // sort sets by set number
  data.forEach((workout) => {
    workout.workout_exercises.forEach((workoutExercise) => {
      workoutExercise.sets = workoutExercise.sets.sort(
        (a, b) => a.set_number - b.set_number,
      );
    });
  });

  return data as unknown as WorkoutTemplate[];
}
