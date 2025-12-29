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
      <View className="flex-1 justify-center items-center bg-black/50">
        <View className="w-11/12 bg-white rounded-lg p-4">
          <Text className="text-lg font-bold mb-4">
            Edit Set {set.set_number}
          </Text>

          <View className="mb-4">
            <Text className="mb-1">Actual Load (kg)</Text>
            <TextInput
              className="border border-gray-300 rounded p-2"
              keyboardType="numeric"
              value={actualLoad}
              onChangeText={setActualLoad}
              placeholder="e.g., 70"
            />
          </View>

          <View className="mb-6">
            <Text className="mb-1">Actual Intensity</Text>
            <TextInput
              className="border border-gray-300 rounded p-2"
              keyboardType="numeric"
              value={actualIntensity}
              onChangeText={setActualIntensity}
              placeholder="e.g., 8"
            />
          </View>

          <View className="flex-row justify-end space-x-2">
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 border border-gray-300 rounded"
            >
              <Text>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              className="px-4 py-2 bg-blue-500 rounded"
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
        className={`py-3 px-2 ${!isLast ? "border-b border-gray-200" : ""}`}
      >
        <View className="flex-row justify-between items-center">
          <View className="w-8">
            <Text className="text-center">{set.set_number.toString()}</Text>
          </View>
          <View className="w-16">
            <Text className="text-center">{set.prescribed_reps || "--"}</Text>
          </View>
          <View className="w-20">
            <Text className="text-center">
              {set.actual_load
                ? `${set.actual_load} kg`
                : set.suggested_load_min
                  ? `${set.suggested_load_min}-${set.suggested_load_max} kg`
                  : "--"}
            </Text>
          </View>
          <View className="w-16">
            <Text className="text-center">
              {set.prescribed_intensity || "--"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setIsModalVisible(true)}>
            <View className="w-16">
              <Text className="text-center">
                {set.actual_load ? `${set.actual_load} kg` : "--"}
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
    <View className="bg-white rounded-lg p-4 mb-4 shadow-sm">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-lg font-semibold">{exercise.name}</Text>
        {workoutExercise.notes && (
          <Text className="text-sm text-gray-500 italic">
            Notes: {workoutExercise.notes}
          </Text>
        )}
      </View>

      <View className="bg-gray-100 p-2 rounded mb-2">
        <View className="flex-row justify-between px-2">
          <Text className="text-xs text-gray-500 w-8">Set</Text>
          <Text className="text-xs text-gray-500 w-16 text-center">Reps</Text>
          <Text className="text-xs text-gray-500 w-20 text-center">Weight</Text>
          <Text className="text-xs text-gray-500 w-16 text-center">
            Intensity
          </Text>
          <Text className="text-xs text-gray-500 w-16 text-center">Actual</Text>
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

  if (isLoading || !localWorkout) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1 p-4">
        <View className="mb-6 bg-white p-4 rounded-lg shadow-sm">
          <Text className="text-2xl font-bold mb-2">{localWorkout.name}</Text>
          <Text className="text-gray-600">
            {new Date(localWorkout.date).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Text>
          {localWorkout.notes && (
            <View className="mt-3 p-3 bg-blue-50 rounded">
              <Text className="text-blue-800 italic">{localWorkout.notes}</Text>
            </View>
          )}
        </View>

        {localWorkout.workout_exercises?.map((workoutExercise) => (
          <ExerciseCard
            key={workoutExercise.id}
            exercise={workoutExercise.exercise}
            sets={workoutExercise.sets || []}
            workoutExercise={workoutExercise}
            onUpdateSet={handleUpdateSet}
          />
        ))}

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
