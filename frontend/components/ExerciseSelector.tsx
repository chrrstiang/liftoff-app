import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
} from "react-native";
import { useState } from "react";

// Dummy exercise data
const EXERCISES = [
  {
    id: "1",
    name: "Bench Press",
  },
  {
    id: "2",
    name: "Squat",
  },
  {
    id: "3",
    name: "Deadlift",
  },
  {
    id: "4",
    name: "Pull-up",
  },
  {
    id: "5",
    name: "Overhead Press",
  },
  {
    id: "6",
    name: "Bicep Curl",
  },
  {
    id: "7",
    name: "Tricep Dip",
  },
  {
    id: "8",
    name: "Leg Press",
  },
  {
    id: "9",
    name: "Lat Pulldown",
  },
  {
    id: "10",
    name: "Lateral Raise",
  },
  {
    id: "11",
    name: "Leg Curl",
  },
  {
    id: "12",
    name: "Calf Raise",
  },
];

interface ExerciseSelectorProps {
  selectedExercises: typeof EXERCISES;
  onExerciseSelect: (exercise: (typeof EXERCISES)[0]) => void;
  onExerciseRemove: (exerciseId: string) => void;
}

export default function ExerciseSelector({
  selectedExercises,
  onExerciseSelect,
  onExerciseRemove,
}: ExerciseSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredExercises = EXERCISES.filter((exercise) =>
    exercise.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const isExerciseSelected = (exerciseId: string) => {
    return selectedExercises.some((exercise) => exercise.id === exerciseId);
  };

  const renderExerciseItem = ({ item }: { item: (typeof EXERCISES)[0] }) => {
    const isSelected = isExerciseSelected(item.id);
    return (
      <TouchableOpacity
        onPress={() => {
          if (isSelected) {
            onExerciseRemove(item.id);
          } else {
            onExerciseSelect(item);
          }
        }}
        className={`bg-white dark:bg-zinc-800 rounded-lg p-4 mb-3 border ${
          isSelected
            ? "border-green-500 dark:border-green-700 bg-green-50 dark:bg-green-900/20"
            : "border-gray-200 dark:border-zinc-700"
        }`}
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className="text-lg font-semibold dark:text-white mb-1">
              {item.name}
            </Text>
          </View>
          {isSelected && (
            <View className="bg-green-500 dark:bg-green-700 rounded-full p-1">
              <Text className="text-white text-xs font-bold">✓</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="mt-6">
      <Text className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
        Add Exercises
      </Text>

      <View className="mb-4">
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search exercises..."
          className="bg-gray-100 dark:bg-zinc-800 rounded-lg p-3 text-foreground dark:text-white"
          placeholderTextColor="#9ca3af"
        />
      </View>

      <ScrollView className="max-h-64">
        <FlatList
          data={filteredExercises}
          renderItem={renderExerciseItem}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-8">
              <Text className="text-gray-500 dark:text-gray-400">
                No exercises found
              </Text>
            </View>
          }
        />
      </ScrollView>

      {selectedExercises.length > 0 && (
        <View className="mt-4">
          <Text className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Selected Exercises ({selectedExercises.length})
          </Text>
          <View className="flex flex-wrap gap-2">
            {selectedExercises.map((exercise) => (
              <View
                key={exercise.id}
                className="bg-green-100 dark:bg-green-900 px-3 py-1 rounded-full flex-row items-center"
              >
                <Text className="text-green-800 dark:text-green-200 text-sm font-medium">
                  {exercise.name}
                </Text>
                <TouchableOpacity
                  onPress={() => onExerciseRemove(exercise.id)}
                  className="ml-2"
                >
                  <Text className="text-green-600 dark:text-green-400 text-xs font-bold">
                    ×
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
