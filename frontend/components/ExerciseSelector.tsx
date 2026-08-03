import { Input, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { fetchExerciseTemplates } from "@/lib/api/exercises";
import { useTheme } from "@/theme/useTheme";
import { ExerciseTemplate, SetTemplate } from "@/types/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

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
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

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

  return (
    <View className="mt-8">
      <Text variant="overline" tone="muted">
        Add exercises
      </Text>

      <View className="mt-3">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search exercises..."
        />
      </View>

      {/* Proportional rather than a fixed max-h-64, which truncated the list
          on small screens and left dead space on large ones. */}
      <ScrollView
        style={{ maxHeight: height * 0.3 }}
        className="mt-2"
        nestedScrollEnabled
      >
        {filteredExercises.length === 0 ? (
          <View className="py-8">
            <Text variant="body" tone="muted" className="text-center">
              {searchQuery
                ? "No exercise matches that search."
                : "No exercise templates saved yet."}
            </Text>
          </View>
        ) : (
          filteredExercises.map((item, i) => {
            const isSelected = isExerciseSelected(item.id);
            const isExpanded = expandedExercise === item.id;

            return (
              <View key={item.id}>
                {i > 0 ? (
                  <View className="h-px bg-hairline dark:bg-hairline-dark" />
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: isSelected,
                    expanded: isExpanded,
                  }}
                  onPress={() => {
                    if (isSelected) {
                      onExerciseRemove(item.id);
                    } else {
                      // Toggle dropdown for non-selected exercises
                      setExpandedExercise(isExpanded ? null : item.id);
                    }
                  }}
                  className={`flex-row items-center justify-between py-3 ${
                    isSelected
                      ? "bg-surface-strong dark:bg-surface-strong-dark"
                      : "active:bg-surface dark:active:bg-surface-dark"
                  }`}
                >
                  <View className="flex-1 gap-0.5 pr-3">
                    <Text variant="bodyStrong" tone="ink">
                      {item.name}
                    </Text>
                    {!isSelected ? (
                      <Text variant="caption" tone="muted">
                        {item.templates.length} template
                        {item.templates.length !== 1 ? "s" : ""} available
                      </Text>
                    ) : null}
                  </View>

                  {isSelected ? (
                    <Check size={18} strokeWidth={2.5} color={colors.ink} />
                  ) : isExpanded ? (
                    <ChevronDown
                      size={18}
                      strokeWidth={2}
                      color={colors.muted}
                    />
                  ) : (
                    <ChevronRight
                      size={18}
                      strokeWidth={2}
                      color={colors.muted}
                    />
                  )}
                </Pressable>

                {/* Template Dropdown */}
                {isExpanded && !isSelected ? (
                  <View className="pb-2 pl-4">
                    {item.templates.map((template) => (
                      <Pressable
                        key={template.id}
                        accessibilityRole="button"
                        onPress={() => {
                          // Select the exercise with this template
                          onExerciseSelect(item, template);
                          setExpandedExercise(null);
                        }}
                        className="border-l border-hairline py-2.5 pl-3 active:bg-surface dark:border-hairline-dark dark:active:bg-surface-dark"
                      >
                        <Text variant="body" tone="body">
                          {template.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {selectedExercises.length > 0 ? (
        <View className="mt-5">
          <Text variant="overline" tone="muted">
            Selected ({selectedExercises.length})
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {selectedExercises.map((selectedExercise) => (
              <View
                key={selectedExercise.exercise.id}
                className="flex-row items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 dark:bg-ink-dark"
              >
                <Text variant="caption" tone="onInk">
                  {selectedExercise.selectedTemplate.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${selectedExercise.selectedTemplate.name}`}
                  hitSlop={6}
                  onPress={() => onExerciseRemove(selectedExercise.exercise.id)}
                >
                  <X size={12} strokeWidth={2.5} color={colors.canvas} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
