import {
  Button,
  DataTable,
  EmptyState,
  Input,
  Screen,
  Section,
  Sheet,
  Text,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { createExercise } from "@/lib/api/exercises";
import { fetchWorkoutById, updateSet } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import {
  Exercise,
  ExerciseFormData,
  ExerciseFormSet,
  Set,
  Workout,
  WorkoutExercise,
} from "@/types/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Dumbbell, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

/** The attempt-sheet columns, declared once and shared by header and rows. */
const SET_COLUMNS = [
  { key: "set", label: "Set", width: 40 },
  { key: "reps", label: "Reps", width: 56 },
  { key: "load", label: "Load kg" },
  { key: "rpe", label: "RPE", width: 56 },
  { key: "actual", label: "Actual", width: 76 },
];

function SetModal({
  isVisible,
  onClose,
  set,
  onSave,
}: {
  isVisible: boolean;
  onClose: () => void;
  set: Set;
  onSave: (updatedSet: Partial<Set>) => void;
}) {
  const [actualLoad, setActualLoad] = useState<string>(
    set.actual_load?.toString() || "",
  );
  const [actualIntensity, setActualIntensity] = useState<string>(
    set.actual_intensity?.toString() || "",
  );

  const handleSave = () => {
    onSave({
      id: set.id,
      actual_load: actualLoad ? Number(actualLoad) : null,
      actual_intensity: actualIntensity ? Number(actualIntensity) : null,
      is_completed: true,
    });
    onClose();
  };

  return (
    <Sheet
      visible={isVisible}
      title={`Set ${set.set_number}`}
      onCancel={onClose}
      onDone={handleSave}
      doneLabel="Save"
    >
      <View className="gap-5 px-4 py-4">
        <Input
          label="Actual load (kg)"
          keyboardType="numeric"
          value={actualLoad}
          onChangeText={setActualLoad}
          placeholder="70"
        />
        <Input
          label="Actual intensity"
          hint="RPE the set actually felt like."
          keyboardType="numeric"
          value={actualIntensity}
          onChangeText={setActualIntensity}
          placeholder="8"
        />
      </View>
    </Sheet>
  );
}

function ExerciseCard({
  exercise,
  sets,
  workoutExercise,
  onUpdateSet,
}: {
  exercise: Exercise;
  sets: Set[];
  workoutExercise: WorkoutExercise;
  onUpdateSet: (set: Partial<Set>) => void;
}) {
  const [editingSet, setEditingSet] = useState<Set | null>(null);

  const rows = sets.map((set) => ({
    key: set.id,
    cells: {
      set: set.set_number,
      reps: set.prescribed_reps,
      load: set.suggested_load_min
        ? `${set.suggested_load_min}–${set.suggested_load_max}`
        : null,
      rpe: set.prescribed_intensity,
      actual: set.actual_load
        ? `${set.actual_load}@${set.actual_intensity}`
        : null,
    },
    // The logged value is the athlete's own entry, so it carries the accent
    // while everything prescribed stays in body tone.
    emphasis: set.actual_load ? ["actual"] : undefined,
    onPress: () => setEditingSet(set),
  }));

  return (
    <Section label={exercise.name} className="mt-8">
      {workoutExercise.notes ? (
        <Text variant="caption" tone="muted" className="pb-3">
          {workoutExercise.notes}
        </Text>
      ) : null}

      <DataTable
        columns={SET_COLUMNS}
        rows={rows}
        emptyMessage="No sets prescribed"
      />

      {editingSet ? (
        <SetModal
          isVisible
          onClose={() => setEditingSet(null)}
          set={editingSet}
          onSave={onUpdateSet}
        />
      ) : null}
    </Section>
  );
}

function AddExerciseModal({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: ExerciseFormData) => void;
}) {
  const { height } = useWindowDimensions();
  const [formData, setFormData] = useState<ExerciseFormData>({
    name: "",
    workout_id: "",
    created_by: "",
    order: 0,
    sets: [
      {
        prescribed_reps: null,
        prescribed_intensity: null,
        suggested_load_min: null,
        suggested_load_max: null,
      },
    ],
  });

  const addSet = () => {
    setFormData((prev) => ({
      ...prev,
      sets: [
        ...prev.sets,
        {
          prescribed_reps: null,
          prescribed_intensity: null,
          suggested_load_min: null,
          suggested_load_max: null,
        },
      ],
    }));
  };

  const updateSet = (
    index: number,
    field: keyof ExerciseFormSet,
    value: string | number | null,
  ) => {
    const newSets = [...formData.sets];
    newSets[index] = { ...newSets[index], [field]: value };
    setFormData((prev) => ({ ...prev, sets: newSets }));
  };

  const removeSet = (index: number) => {
    if (formData.sets.length === 1) return;

    const newSets = formData.sets.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, sets: newSets }));
  };

  const handleSave = () => {
    const formattedData = {
      ...formData,
      sets: formData.sets.map((set, index) => ({
        prescribed_reps: Number(set.prescribed_reps),
        prescribed_intensity: set.prescribed_intensity || null,
        suggested_load_min: Number(set.suggested_load_min) || null,
        suggested_load_max: Number(set.suggested_load_max) || null,
        set_number: index + 1,
      })),
    };

    onSave(formattedData);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title="Add exercise"
      onCancel={onClose}
      onDone={handleSave}
      doneLabel="Save"
    >
      {/* Proportional to the viewport, matching SelectSheet. A `vh` class would
          compile on web and be silently ignored on native. */}
      <ScrollView style={{ maxHeight: height * 0.6 }} className="px-4">
        <View className="py-4">
          <Input
            label="Exercise name"
            value={formData.name}
            onChangeText={(text) =>
              setFormData((prev) => ({ ...prev, name: text }))
            }
            placeholder="Bench press"
          />
        </View>

        <View className="flex-row items-center justify-between border-t border-hairline pt-4 dark:border-hairline-dark">
          <Text variant="overline" tone="muted">
            Sets
          </Text>
          <Button label="Add set" variant="ghost" onPress={addSet} />
        </View>

        {formData.sets.map((set, index) => (
          <View
            key={index}
            className="gap-3 border-t border-hairline py-4 dark:border-hairline-dark"
          >
            <View className="flex-row items-center justify-between">
              <Text variant="label" tone="ink">
                Set {index + 1}
              </Text>
              {formData.sets.length > 1 ? (
                <Button
                  label="Remove"
                  variant="danger"
                  onPress={() => removeSet(index)}
                />
              ) : null}
            </View>

            <View className="flex-row gap-2">
              <Input
                label="Reps"
                className="flex-1"
                value={set.prescribed_reps ? set.prescribed_reps.toString() : ""}
                onChangeText={(text) =>
                  updateSet(index, "prescribed_reps", text || null)
                }
                placeholder="12"
                keyboardType="number-pad"
              />
              <Input
                label="RPE"
                className="flex-1"
                value={set.prescribed_intensity ? set.prescribed_intensity : ""}
                onChangeText={(text) =>
                  updateSet(index, "prescribed_intensity", text || null)
                }
                placeholder="7"
              />
            </View>

            <View className="flex-row gap-2">
              <Input
                label="Load min"
                className="flex-1"
                value={
                  set.suggested_load_min
                    ? set.suggested_load_min.toString()
                    : ""
                }
                onChangeText={(text) =>
                  updateSet(index, "suggested_load_min", text || null)
                }
                placeholder="0"
                keyboardType="number-pad"
              />
              <Input
                label="Load max"
                className="flex-1"
                value={
                  set.suggested_load_max
                    ? set.suggested_load_max.toString()
                    : ""
                }
                onChangeText={(text) =>
                  updateSet(index, "suggested_load_max", text || null)
                }
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

export default function WorkoutDetails() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const [localWorkout, setLocalWorkout] = useState<Workout | null>(null);
  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const { user } = useAuth();

  // fetching workout by id
  const {
    data: workout,
    isLoading,
    isSuccess,
  } = useQuery<Workout>({
    queryKey: ["workout", workoutId],
    queryFn: () => fetchWorkoutById(workoutId),
  });

  // update local state with workout data
  useEffect(() => {
    if (isSuccess) {
      setLocalWorkout(workout);
    }
  }, [isSuccess, workout]);

  // mutation handling for set logging
  const updateSetMutation = useMutation({
    mutationFn: (updatedSet: Set) => updateSet(updatedSet),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workout", workoutId] });
    },
  });

  // mutation handling for exercise creation
  const addExerciseMutation = useMutation({
    mutationFn: (exerciseData: ExerciseFormData) =>
      createExercise(exerciseData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workout", workoutId] });
      setShowAddExerciseModal(false);
    },
    onMutate: async (newExercise) => {
      await queryClient.cancelQueries({ queryKey: ["workout", workoutId] });
      const previousWorkout = queryClient.getQueryData<Workout>([
        "workout",
        workoutId,
      ]);

      queryClient.setQueryData<Workout>(["workout", workoutId], (old) => {
        if (!old) return old;

        return {
          ...old,
          workout_exercises: [
            ...old.workout_exercises,
            {
              id: "temp-" + Date.now(),
              name: newExercise.name,
              order: old.workout_exercises.length + 1,
              notes: null,
              exercise: {
                id: "temp-exercise-" + Date.now(),
                name: newExercise.name,
              },
              sets: newExercise.sets.map((set, index) => ({
                id: "temp-set-" + Date.now() + "-" + index,
                set_number: set.set_number || index + 1,
                prescribed_reps: set.prescribed_reps,
                prescribed_intensity: set.prescribed_intensity || null,
                suggested_load_min: set.suggested_load_min || null,
                suggested_load_max: set.suggested_load_max || null,
                actual_load: null,
                actual_intensity: null,
                is_completed: false,
              })),
            },
          ],
        };
      });
      return { previousWorkout };
    },
    onError: (error, newExercise, context) => {
      if (context?.previousWorkout) {
        queryClient.setQueryData(
          ["workout", workoutId],
          context.previousWorkout,
        );
      }
      console.error("Error adding exercise", error);
    },
  });

  const handleUpdateSet = async (updatedSet: Partial<Set>) => {
    if (!localWorkout) return;

    const updatedWorkout = {
      ...localWorkout,
      workout_exercises: localWorkout.workout_exercises.map((we) => ({
        ...we,
        sets: we.sets.map((s) =>
          s.id === updatedSet.id ? { ...s, ...updatedSet } : s,
        ),
      })),
    };

    setLocalWorkout(updatedWorkout);
    await updateSetMutation.mutateAsync(updatedSet as Set);
  };

  const handleSaveExercise = (exerciseData: ExerciseFormData) => {
    if (!user) return;
    const exercise = {
      ...exerciseData,
      workout_id: workoutId,
      created_by: user?.id,
      order: localWorkout?.workout_exercises?.length
        ? localWorkout?.workout_exercises?.length + 1
        : 1,
    };

    addExerciseMutation.mutate(exercise);
  };

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const exercises = localWorkout?.workout_exercises ?? [];

  return (
    <Screen scroll>
      <View className="px-6 pb-32 pt-2">
        {workout?.notes ? (
          <View className="rounded-card border-l-2 border-primary bg-surface p-4 dark:border-primary-dark dark:bg-surface-dark">
            <Text variant="overline" tone="muted">
              Coach notes
            </Text>
            <Text variant="body" tone="ink" className="mt-1">
              {workout.notes}
            </Text>
          </View>
        ) : null}

        {exercises.length === 0 ? (
          <View className="py-24">
            <EmptyState
              icon={Dumbbell}
              title="No exercises yet"
              body="Add the first exercise to start building this session."
              actionLabel="Add exercise"
              onAction={() => setShowAddExerciseModal(true)}
            />
          </View>
        ) : (
          exercises.map((workoutExercise) => (
            <ExerciseCard
              key={workoutExercise.id}
              exercise={workoutExercise.exercise}
              sets={workoutExercise.sets || []}
              workoutExercise={workoutExercise}
              onUpdateSet={handleUpdateSet}
            />
          ))
        )}
      </View>

      {/* No shadow: the coral fill against canvas carries the elevation. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add exercise"
        onPress={() => setShowAddExerciseModal(true)}
        className="absolute bottom-8 right-6 h-14 w-14 items-center justify-center rounded-pill bg-primary active:bg-primary-pressed dark:bg-primary-dark"
      >
        <Plus size={24} strokeWidth={2.5} color={colors.onPrimary} />
      </Pressable>

      <AddExerciseModal
        visible={showAddExerciseModal}
        onClose={() => setShowAddExerciseModal(false)}
        onSave={handleSaveExercise}
      />
    </Screen>
  );
}
