import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWorkoutById, updateSet } from "@/lib/api/workouts";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import {
  Workout,
  Set,
  WorkoutExercise,
  Exercise,
  ExerciseFormData,
  ExerciseFormSet,
} from "@/types/types";
import { Plus } from "lucide-react-native";
import { createExercise } from "@/lib/api/exercises";
import { useAuth } from "@/contexts/AuthContext";

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
    <Modal
      visible={isVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-center items-center bg-black/70">
        <View className="w-11/12 bg-white dark:bg-zinc-900 rounded-lg p-4">
          <Text className="text-lg font-bold mb-4 text-foreground dark:text-white">
            Edit Set {set.set_number}
          </Text>

          <View className="mb-4">
            <Text className="mb-1 text-foreground dark:text-gray-300">
              Actual Load (kg)
            </Text>
            <TextInput
              className="border border-gray-300 dark:border-zinc-800 rounded p-2 dark:bg-zinc-900 text-foreground dark:text-white"
              keyboardType="numeric"
              value={actualLoad}
              onChangeText={setActualLoad}
              placeholder="e.g., 70"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View className="mb-6">
            <Text className="mb-1 text-foreground dark:text-gray-300">
              Actual Intensity
            </Text>
            <TextInput
              className="border border-gray-300 dark:border-zinc-800 rounded p-2 bg-white dark:bg-zinc-900 text-foreground dark:text-white"
              keyboardType="numeric"
              value={actualIntensity}
              onChangeText={setActualIntensity}
              placeholder="e.g., 8"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View className="flex-row justify-end space-x-2">
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-zinc-600 rounded"
            >
              <Text className="text-foreground dark:text-gray-300">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              className="px-4 py-2 bg-violet-500 dark:bg-violet-700 rounded"
            >
              <Text className="text-white">Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SetItem({
  set,
  isLast,
  onUpdateSet,
}: {
  set: Set;
  isLast: boolean;
  onUpdateSet: (set: Partial<Set>) => void;
}) {
  const [isModalVisible, setIsModalVisible] = useState(false);

  return (
    <>
      <View
        className={`py-3 px-2 ${!isLast ? "border-b border-gray-200 dark:border-zinc-700" : ""}`}
      >
        <View className="flex-row justify-between items-center">
          <View className="w-8">
            <Text className="text-center text-foreground dark:text-gray-300">
              {set.set_number.toString()}
            </Text>
          </View>
          <View className="w-16">
            <Text className="text-center text-foreground dark:text-gray-300">
              {set.prescribed_reps || "--"}
            </Text>
          </View>
          <View className="w-20">
            <Text className="text-center text-foreground dark:text-gray-300">
              {set.suggested_load_min
                ? `${set.suggested_load_min}-${set.suggested_load_max}`
                : "--"}
            </Text>
          </View>
          <View className="w-16">
            <Text className="text-center text-foreground dark:text-gray-300">
              {set.prescribed_intensity || "--"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setIsModalVisible(true)}>
            <View className="w-16">
              <Text
                className={`text-center ${set.actual_load ? "font-medium text-violet-500 dark:text-violet-400" : "text-foreground dark:text-gray-300"}`}
              >
                {set.actual_load
                  ? `${set.actual_load}@${set.actual_intensity}`
                  : "--"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <SetModal
        isVisible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        set={set}
        onSave={onUpdateSet}
      />
    </>
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
  return (
    <View className="bg-white dark:bg-zinc-900 rounded-lg p-4 mb-4 shadow-sm">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-lg font-semibold text-foreground dark:text-white">
          {exercise.name}
        </Text>
        {workoutExercise.notes && (
          <Text className="text-sm text-gray-500 dark:text-gray-400 italic">
            Notes: {workoutExercise.notes}
          </Text>
        )}
      </View>

      <View className="bg-gray-100 dark:bg-zinc-800 p-2 rounded mb-2">
        <View className="flex-row justify-between px-2">
          <Text className="text-xs text-gray-500 dark:text-gray-400 w-8">
            Set
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 w-16 text-center">
            Reps
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 w-20 text-center">
            Weight (kg)
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 w-16 text-center">
            Intensity
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 w-16 text-center">
            Actual
          </Text>
        </View>
      </View>

      <View>
        {sets.map((set, index) => (
          <SetItem
            key={set.id}
            set={set}
            isLast={index === sets.length - 1}
            onUpdateSet={onUpdateSet}
          />
        ))}
      </View>
    </View>
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
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <View className="flex-1 justify-center bg-black/50">
            <View className="bg-white dark:bg-zinc-800 rounded-t-2xl p-6 max-h-[90%]">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-xl font-semibold dark:text-white">
                  Add Exercise
                </Text>
                <TouchableOpacity onPress={onClose}>
                  <Text className="text-blue-500 text-lg">Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView className="mb-4">
                {/* Exercise Name */}
                <View className="mb-6">
                  <Text className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    Exercise Name
                  </Text>
                  <TextInput
                    value={formData.name}
                    onChangeText={(text) =>
                      setFormData((prev) => ({ ...prev, name: text }))
                    }
                    placeholder="e.g., Bench Press"
                    className="bg-gray-100 dark:bg-zinc-700 rounded-lg p-3 text-foreground dark:text-white"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                {/* Sets */}
                <View className="mb-4">
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-lg font-medium text-foreground dark:text-white">
                      Sets
                    </Text>
                    <TouchableOpacity
                      onPress={addSet}
                      className="bg-violet-500 dark:bg-violet-700 px-3 py-1.5 rounded-lg"
                    >
                      <Text className="text-white text-sm">+ Add Set</Text>
                    </TouchableOpacity>
                  </View>
                  {formData.sets.map((set, index) => (
                    <View
                      key={index}
                      className="mb-4 bg-gray-100 dark:bg-zinc-700 p-3 rounded-lg"
                    >
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="font-medium text-foreground dark:text-white">
                          Set {index + 1}
                        </Text>
                        {formData.sets.length > 1 && (
                          <TouchableOpacity onPress={() => removeSet(index)}>
                            <Text className="text-red-500">Remove</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <View className="flex-row space-x-2 mb-2">
                        <View className="flex-1">
                          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Reps
                          </Text>
                          <TextInput
                            value={
                              set.prescribed_reps
                                ? set.prescribed_reps.toString()
                                : ""
                            }
                            onChangeText={(text) =>
                              updateSet(index, "prescribed_reps", text || null)
                            }
                            placeholder="12"
                            keyboardType="number-pad"
                            className="bg-white dark:bg-zinc-800 rounded-lg p-2 text-foreground dark:text-white text-center"
                            placeholderTextColor="#9ca3af"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Intensity
                          </Text>
                          <TextInput
                            value={
                              set.prescribed_intensity
                                ? set.prescribed_intensity
                                : ""
                            }
                            onChangeText={(text) =>
                              updateSet(
                                index,
                                "prescribed_intensity",
                                text || null,
                              )
                            }
                            placeholder="RPE 7"
                            className="bg-white dark:bg-zinc-800 rounded-lg p-2 text-foreground dark:text-white text-center"
                            placeholderTextColor="#9ca3af"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Min
                          </Text>
                          <TextInput
                            value={
                              set.suggested_load_min
                                ? set.suggested_load_min.toString()
                                : ""
                            }
                            onChangeText={(text) =>
                              updateSet(
                                index,
                                "suggested_load_min",
                                text || null,
                              )
                            }
                            placeholder="0"
                            keyboardType="number-pad"
                            className="bg-white dark:bg-zinc-800 rounded-lg p-2 text-foreground dark:text-white text-center"
                            placeholderTextColor="#9ca3af"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Max
                          </Text>
                          <TextInput
                            value={
                              set.suggested_load_max
                                ? set.suggested_load_max.toString()
                                : ""
                            }
                            onChangeText={(text) =>
                              updateSet(
                                index,
                                "suggested_load_max",
                                text || null,
                              )
                            }
                            placeholder="0"
                            keyboardType="number-pad"
                            className="bg-white dark:bg-zinc-800 rounded-lg p-2 text-foreground dark:text-white text-center"
                            placeholderTextColor="#9ca3af"
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
              {/* Save Button */}
              <TouchableOpacity
                onPress={handleSave}
                disabled={!formData.name.trim()}
                className={`mt-4 py-3 rounded-lg items-center ${
                  !formData.name.trim()
                    ? "bg-gray-300 dark:bg-gray-600"
                    : "bg-violet-500 dark:bg-violet-700"
                }`}
              >
                <Text className="text-white font-medium">Save Exercise</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

export default function WorkoutDetails() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const queryClient = useQueryClient();
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
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <ScrollView className="flex-1 p-4">
        {workout?.notes && (
          <View className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <Text className="text-yellow-800 dark:text-yellow-300 font-medium">
              Workout Notes:
            </Text>
            <Text className="text-yellow-700 dark:text-yellow-200 mt-1">
              {workout.notes}
            </Text>
          </View>
        )}
        <View className="mb-4">
          <Text className="text-lg font-semibold mb-3 text-foreground dark:text-white">
            Exercises
          </Text>
          {localWorkout?.workout_exercises.map((workoutExercise) => (
            <View key={workoutExercise.id} className="mb-8">
              <ExerciseCard
                exercise={workoutExercise.exercise}
                sets={workoutExercise.sets || []}
                workoutExercise={workoutExercise}
                onUpdateSet={handleUpdateSet}
              />
            </View>
          ))}
        </View>

        <View className="h-24" />
      </ScrollView>
      <TouchableOpacity
        onPress={() => setShowAddExerciseModal(true)}
        className="absolute bottom-16 right-8 bg-violet-500 dark:bg-violet-700 w-20 h-20 rounded-full items-center justify-center shadow-lg shadow-black/25"
      >
        <Plus
          size={36}
          absoluteStrokeWidth={true}
          strokeWidth={2.5}
          color="white"
        />
      </TouchableOpacity>
      <AddExerciseModal
        visible={showAddExerciseModal}
        onClose={() => setShowAddExerciseModal(false)}
        onSave={handleSaveExercise}
      />
    </SafeAreaView>
  );
}
