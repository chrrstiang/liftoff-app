import { ExerciseFormData, ExerciseTemplate } from "@/types/types";
import { supabase } from "../supabase";

export async function createExercise(exerciseData: ExerciseFormData) {
  // add exercise to exercises
  const { data: exercise, error: exerciseError } = await supabase
    .from("exercises")
    .insert({
      name: exerciseData.name,
      created_by: exerciseData.created_by,
    })
    .select()
    .single();

  if (exerciseError) {
    console.error("Error adding exercise", exerciseError);
    return;
  }

  console.log("Exercise added successfully", exercise);
  // add workout_exercises record with exercise id and workout id
  const { data: workoutExercise, error: workoutExerciseError } = await supabase
    .from("workout_exercises")
    .insert({
      exercise_id: exercise.id,
      workout_id: exerciseData.workout_id,
      order: exerciseData.order,
    })
    .select()
    .single();

  if (workoutExerciseError) {
    console.error("Error adding workout exercise", workoutExerciseError);
    return;
  }

  console.log("Workout exercise added successfully", workoutExercise);

  const workoutExerciseId = workoutExercise.id;

  const setQuery = exerciseData.sets.map((set) => ({
    ...set,
    workout_exercise_id: workoutExerciseId,
  }));

  console.log("Set query", setQuery);

  // add sets with workout_exercises_id
  const { data: sets, error: setsError } = await supabase
    .from("sets")
    .insert(setQuery)
    .select();

  if (setsError) {
    console.error("Error adding sets", setsError);
    return;
  }

  console.log("Sets added successfully", sets);
}

export async function fetchExerciseTemplates(coachId: string) {
  const { data, error } = await supabase
    .from("exercises")
    .select(
      `
      id, 
      name,
      templates:exercise_templates (
        id, 
        name, 
        sets:exercise_default_set_templates(
          id, 
          set_number, 
          prescribed_reps, 
          prescribed_intensity
        )
      )
    `,
    )
    .neq("exercise_template_id", null)
    .eq("created_by", coachId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // sort sets by set number
  data.forEach((exercise) => {
    exercise.templates.forEach((template) => {
      template.sets = template.sets.sort((a, b) => a.set_number - b.set_number);
    });
  });

  return data as ExerciseTemplate[];
}
