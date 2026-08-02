import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
} from "react-native";
import { useState } from "react";
import { ExerciseTemplate, SetTemplate } from "@/types/types";
import { fetchExerciseTemplates } from "@/lib/api/exercises";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface ExerciseSelectorProps {
  selectedExercises: {
    exercise: ExerciseTemplate;
    selectedTemplate: { id: string; name: string; sets: SetTemplate[] };
  }[];
  onExerciseSelect: (
    exercise: ExerciseTemplate,
    selectedTemplate: { id: string; name: string; sets: SetTemplate[] },
  ) => void;
  onExerciseRemove: (exerciseId: string) => void;
}

export default function ExerciseSelector({
  selectedExercises,
  onExerciseSelect,
  onExerciseRemove,
}: ExerciseSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);

  const { user } = useAuth();

  const { data: templates = [] } = useQuery({
    queryKey: ["templateExercises", user?.id],
    queryFn: () => (user?.id ? fetchExerciseTemplates(user.id) : []),
    enabled: !!user?.id,
  });

  const filteredExercises = templates.filter((exercise) =>
    exercise.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const isExerciseSelected = (exerciseId: string) => {
    return selectedExercises.some(
      (selectedExercise) => selectedExercise.exercise.id === exerciseId,
    );
  };

  const renderExerciseItem = ({ item }: { item: ExerciseTemplate }) => {
    const isSelected = isExerciseSelected(item.id);
    const isExpanded = expandedExercise === item.id;

    return (
      <View className="mb-3">
        <TouchableOpacity
          onPress={() => {
            if (isSelected) {
              onExerciseRemove(item.id);
            } else {
              // Toggle dropdown for non-selected exercises
              setExpandedExercise(isExpanded ? null : item.id);
            }
          }}
          className={`bg-white dark:bg-zinc-800 rounded-lg p-4 border ${
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
              {!isSelected && (
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  {item.templates.length} template
                  {item.templates.length !== 1 ? "s" : ""} available
                </Text>
              )}
            </View>
            <View className="flex-row items-center">
              {!isSelected && (
                <Text className="text-gray-400 dark:text-gray-500 mr-2">
                  {isExpanded ? "▼" : "▶"}
                </Text>
              )}
              {isSelected && (
                <View className="bg-green-500 dark:bg-green-700 rounded-full p-1">
                  <Text className="text-white text-xs font-bold">✓</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* Template Dropdown */}
        {isExpanded && !isSelected && (
          <View className="mt-2 ml-4 mr-2">
            {item.templates.map((template) => (
              <TouchableOpacity
                key={template.id}
                onPress={() => {
                  // Select the exercise with this template
                  onExerciseSelect(item, template);
                  setExpandedExercise(null);
                }}
                className="bg-gray-50 dark:bg-zinc-700 rounded-lg p-3 mb-2 border border-gray-200 dark:border-zinc-600"
              >
                <Text className="text-base font-medium dark:text-white">
                  {template.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
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
            {selectedExercises.map((selectedExercise) => (
              <View
                key={selectedExercise.exercise.id}
                className="bg-green-100 dark:bg-green-900 px-3 py-1 rounded-full flex-row items-center"
              >
                <Text className="text-green-800 dark:text-green-200 text-sm font-medium">
                  {selectedExercise.selectedTemplate.name}
                </Text>
                <TouchableOpacity
                  onPress={() => onExerciseRemove(selectedExercise.exercise.id)}
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
