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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { Workout, Set, WorkoutExercise, Exercise } from "@/types/types";

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
    set.actual_load?.toString() || ""
  );
  const [actualIntensity, setActualIntensity] = useState<string>(
    set.actual_intensity?.toString() || ""
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

export default function WorkoutDetails() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const queryClient = useQueryClient();
  const [localWorkout, setLocalWorkout] = useState<Workout | null>(null);

  const {
    data: workout,
    isLoading,
    isSuccess,
  } = useQuery<Workout>({
    queryKey: ["workout", workoutId],
    queryFn: () => fetchWorkoutById(workoutId),
  });

  useEffect(() => {
    if (isSuccess) {
      setLocalWorkout(workout);
    }
  }, [isSuccess, workout]);

  const updateSetMutation = useMutation({
    mutationFn: (updatedSet: Set) => updateSet(updatedSet),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workout", workoutId] });
    },
  });

  const handleUpdateSet = async (updatedSet: Partial<Set>) => {
    if (!localWorkout) return;

    const updatedWorkout = {
      ...localWorkout,
      workout_exercises: localWorkout.workout_exercises.map((we) => ({
        ...we,
        sets: we.sets.map((s) =>
          s.id === updatedSet.id ? { ...s, ...updatedSet } : s
        ),
      })),
    };

    setLocalWorkout(updatedWorkout);
    await updateSetMutation.mutateAsync(updatedSet as Set);
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

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
