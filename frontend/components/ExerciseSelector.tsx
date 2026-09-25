import {
  emptySet,
  ExerciseSetsEditor,
} from "@/components/ExerciseSetsEditor";
import { Button, Input, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { describeApiError } from "@/lib/api/client";
import {
  createLibraryExercise,
  fetchExercises,
  fetchExerciseTemplates,
} from "@/lib/api/exercises";
import { useTheme } from "@/theme/useTheme";
import type { ExerciseFormSet, SelectedExercise, SetTemplate } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

/** A movement in the picker: always from the library, sometimes with presets. */
interface PickableExercise {
  id: string;
  name: string;
  presets: { id: string; name: string; sets: SetTemplate[] }[];
}

export interface ExerciseSelectorProps {
  selectedExercises: SelectedExercise[];
  onChange: (next: SelectedExercise[]) => void;
}

/**
 * Picking the movements a workout is built from.
 *
 * ⚠️ **This used to render only saved exercise presets, and nothing in the app
 * ever created one.** So the list was empty for every coach, `selectedExercises`
 * could never be non-empty, and `CreateWorkoutDto.exercises` has
 * `@ArrayMinSize(1)` — which meant a coach on a fresh account could not create a
 * workout at all. Both halves of the builder were dead: the template picker had
 * no templates, and the custom path had nothing to pick.
 *
 * It now reads the **library** (`GET /exercises`) and attaches presets where they
 * exist, so a saved default is a shortcut rather than a gate. A movement with no
 * presets opens the set editor; a coach with an empty library can add one by name
 * without leaving the sheet.
 */
export default function ExerciseSelector({
  selectedExercises,
  onChange,
}: ExerciseSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: library = [], isLoading: libraryLoading } = useQuery({
    queryKey: ["exercises", user?.id],
    queryFn: fetchExercises,
    enabled: !!user?.id,
  });

  const { data: presetGroups = [] } = useQuery({
    queryKey: ["templateExercises", user?.id],
    queryFn: fetchExerciseTemplates,
    enabled: !!user?.id,
  });

  /* The library is the spine. Presets attach to it by exercise id rather than
     being a list of their own — a preset without its movement is not something
     the builder can express, and keying off the library is what stops a coach
     with no presets seeing an empty picker. */
  const exercises: PickableExercise[] = useMemo(() => {
    const presetsByExercise = new Map(
      presetGroups.map((group) => [group.id, group.templates]),
    );

    return library.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      presets: presetsByExercise.get(exercise.id) ?? [],
    }));
  }, [library, presetGroups]);

  const query = searchQuery.trim();
  const filtered = exercises.filter((exercise) =>
    exercise.name.toLowerCase().includes(query.toLowerCase()),
  );

  const exactMatch = exercises.some(
    (exercise) => exercise.name.toLowerCase() === query.toLowerCase(),
  );

  const selectionFor = (exerciseId: string) =>
    selectedExercises.find((s) => s.exerciseId === exerciseId);

  const select = (exercise: PickableExercise, label: string, sets: ExerciseFormSet[]) => {
    onChange([...selectedExercises, { exerciseId: exercise.id, label, sets }]);
    setExpandedExercise(exercise.id);
  };

  const remove = (exerciseId: string) => {
    onChange(selectedExercises.filter((s) => s.exerciseId !== exerciseId));
    setExpandedExercise((current) => (current === exerciseId ? null : current));
  };

  const updateSets = (exerciseId: string, sets: ExerciseFormSet[]) => {
    onChange(
      selectedExercises.map((s) =>
        s.exerciseId === exerciseId ? { ...s, sets } : s,
      ),
    );
  };

  /* Idempotent on name server-side, so a coach who types a movement they already
     have gets the existing row back rather than a duplicate — which matters,
     because duplicate names split an athlete's max between them. */
  const addToLibrary = useMutation({
    mutationFn: (name: string) => createLibraryExercise(name),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["exercises", user?.id] });
      setSearchQuery("");
      select({ id: created.id, name: created.name, presets: [] }, created.name, [
        emptySet(),
      ]);
    },
    onError: (error) =>
      Alert.alert(
        "Could not add it",
        describeApiError(error, "That movement could not be added to your library."),
      ),
  });

  return (
    <View className="mt-8">
      <Text variant="overline" tone="muted">
        Add exercises
      </Text>

      <View className="mt-3">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search or add a movement..."
          autoCapitalize="words"
        />
      </View>

      {/* Proportional rather than a fixed max-h-64, which truncated the list
          on small screens and left dead space on large ones. */}
      <ScrollView
        style={{ maxHeight: height * 0.3 }}
        className="mt-2"
        nestedScrollEnabled
      >
        {libraryLoading ? (
          <View className="py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {!libraryLoading && filtered.length === 0 ? (
          <View className="py-8">
            <Text variant="body" tone="muted" className="text-center">
              {query
                ? "No movement matches that."
                : "Your library is empty. Type a movement name to add one."}
            </Text>
          </View>
        ) : null}

        {filtered.map((item, i) => {
          const selection = selectionFor(item.id);
          const isExpanded = expandedExercise === item.id;

          return (
            <View key={item.id}>
              {i > 0 ? (
                <View className="h-px bg-hairline dark:bg-hairline-dark" />
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: !!selection,
                  expanded: isExpanded,
                }}
                onPress={() => setExpandedExercise(isExpanded ? null : item.id)}
                className={`flex-row items-center justify-between py-3 ${
                  selection
                    ? "bg-surface-strong dark:bg-surface-strong-dark"
                    : "active:bg-surface dark:active:bg-surface-dark"
                }`}
              >
                <View className="flex-1 gap-0.5 pr-3">
                  <Text variant="bodyStrong" tone="ink">
                    {item.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {selection
                      ? `${selection.sets.length} set${selection.sets.length !== 1 ? "s" : ""}`
                      : item.presets.length > 0
                        ? `${item.presets.length} saved default${item.presets.length !== 1 ? "s" : ""}`
                        : "Tap to add sets"}
                  </Text>
                </View>

                {selection ? (
                  <Check size={18} strokeWidth={2.5} color={colors.ink} />
                ) : isExpanded ? (
                  <ChevronDown size={18} strokeWidth={2} color={colors.muted} />
                ) : (
                  <ChevronRight size={18} strokeWidth={2} color={colors.muted} />
                )}
              </Pressable>

              {isExpanded && !selection ? (
                <View className="pb-2 pl-4">
                  {item.presets.map((preset) => (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      onPress={() =>
                        select(
                          item,
                          preset.name,
                          preset.sets.map((set) => ({
                            prescribed_reps: set.prescribed_reps,
                            prescribed_intensity: set.prescribed_intensity,
                            prescribed_percent: set.prescribed_percent ?? null,
                            suggested_load_min: set.suggested_load_min ?? null,
                            suggested_load_max: set.suggested_load_max ?? null,
                          })),
                        )
                      }
                      className="border-l border-hairline py-2.5 pl-3 active:bg-surface dark:border-hairline-dark dark:active:bg-surface-dark"
                    >
                      <Text variant="body" tone="body">
                        {preset.name}
                      </Text>
                    </Pressable>
                  ))}

                  {/* Always offered, presets or not. A saved default is a
                      starting point, not the only way in. */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => select(item, item.name, [emptySet()])}
                    className="border-l border-hairline py-2.5 pl-3 active:bg-surface dark:border-hairline-dark dark:active:bg-surface-dark"
                  >
                    <Text variant="body" tone="primary">
                      Enter sets manually
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {isExpanded && selection ? (
                <View className="pb-4 pl-4">
                  <ExerciseSetsEditor
                    sets={selection.sets}
                    onChange={(sets) => updateSets(item.id, sets)}
                  />
                  <View className="mt-3">
                    <Button
                      label="Remove exercise"
                      variant="danger"
                      onPress={() => remove(item.id)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {/* An empty library is the normal state of a new coach, so adding to it
            has to be reachable from the place they first look.
            Held back until the library has loaded: `exercises` is `[]` in flight,
            so `exactMatch` is false for everything and a movement they already
            have would briefly offer to be added again. */}
        {query && !exactMatch && !libraryLoading ? (
          <Pressable
            accessibilityRole="button"
            disabled={addToLibrary.isPending}
            onPress={() => addToLibrary.mutate(query)}
            className="flex-row items-center gap-2 border-t border-hairline py-3 active:bg-surface dark:border-hairline-dark dark:active:bg-surface-dark"
          >
            {addToLibrary.isPending ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Plus size={16} strokeWidth={2.5} color={colors.primary} />
            )}
            <Text variant="bodyStrong" tone="primary">
              Add &ldquo;{query}&rdquo; to your library
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {selectedExercises.length > 0 ? (
        <View className="mt-5">
          <Text variant="overline" tone="muted">
            Selected ({selectedExercises.length})
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {selectedExercises.map((selected) => (
              <View
                key={selected.exerciseId}
                className="flex-row items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 dark:bg-ink-dark"
              >
                <Text variant="caption" tone="onInk">
                  {selected.label}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${selected.label}`}
                  hitSlop={6}
                  onPress={() => remove(selected.exerciseId)}
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
