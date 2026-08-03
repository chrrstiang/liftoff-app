import ExerciseSelector from "@/components/ExerciseSelector";
import {
  Button,
  EmptyState,
  Input,
  Screen,
  Section,
  Sheet,
  SheetRow,
  Text,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import {
  createWorkout,
  fetchAthleteWorkouts,
  fetchTemplateWorkouts,
} from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import {
  ExerciseFormSet,
  ExerciseTemplate,
  SetTemplate,
  WorkoutTemplate,
} from "@/types/types";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays, Check } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  useColorScheme,
  View,
} from "react-native";

type SelectedExercise = {
  exercise: ExerciseTemplate;
  selectedTemplate: { id: string; name: string; sets: SetTemplate[] };
};

const WeeklyWorkoutCard = ({ athleteId }: { athleteId: string }) => {
  const { colors } = useTheme();
  const { data: workoutData, isLoading } = useQuery({
    queryKey: ["workouts", athleteId],
    queryFn: async () => fetchAthleteWorkouts(athleteId),
  });

  const getCurrentDayName = () => {
    const dateName = new Date().toLocaleDateString("en-US", {
      weekday: "long",
    });
    return dateName;
  };

  if (isLoading || !workoutData) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (workoutData.length === 0) {
    return (
      <View className="py-16">
        <EmptyState
          icon={CalendarDays}
          title="No workouts yet"
          body="Sessions added to this program will appear here."
        />
      </View>
    );
  }

  return (
    <Section label="Week 1" className="mt-6 px-6">
      {workoutData.map(
        (
          { id, name, date }: { id: string; name: string; date: string },
          index: number,
        ) => {
          const isToday =
            getCurrentDayName() ===
            new Date(date).toLocaleDateString("en-US", { weekday: "long" });

          return (
            <View key={id}>
              {index > 0 ? (
                <View className="h-px bg-hairline dark:bg-hairline-dark" />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  console.log("Directing to workout", id);
                  router.push(`/workout/${id}`);
                }}
                className="flex-row items-center justify-between py-4 active:bg-surface dark:active:bg-surface-dark"
              >
                <Text variant="bodyStrong" tone="ink" className="flex-1 pr-3">
                  {name}
                </Text>
                {/* Monochrome so it reads as a marker, not an action. */}
                {isToday ? (
                  <View className="rounded-pill bg-ink px-2 py-0.5 dark:bg-ink-dark">
                    <Text variant="overline" tone="onInk">
                      Today
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          );
        },
      )}
    </Section>
  );
};

function WorkoutModal({
  visible,
  onClose,
  onCreateWorkout,
  isCreating,
}: {
  visible: boolean;
  onClose: () => void;
  onCreateWorkout: (
    name: string,
    date: string,
    exercises: {
      id: string;
      name: string;
      order: number;
      notes?: string;
      sets: ExerciseFormSet[];
    }[],
    isTemplate: boolean,
  ) => void;
  isCreating: boolean;
}) {
  const [showWorkoutForm, setShowWorkoutForm] = useState(false);
  const [workoutName, setWorkoutName] = useState("");
  const [workoutDate, setWorkoutDate] = useState(new Date());
  const [tempDate, setTempDate] = useState(new Date());
  const [showDateModal, setShowDateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<
    SelectedExercise[]
  >([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<WorkoutTemplate | null>(null);
  const colorScheme = useColorScheme();
  const { colors } = useTheme();
  const { user } = useAuth();

  const { data: templateWorkouts = [], isLoading: templatesLoading } = useQuery(
    {
      queryKey: ["templateWorkouts", user?.id],
      queryFn: () => (user?.id ? fetchTemplateWorkouts(user.id) : []),
      enabled: !!user?.id,
    },
  );

  const filteredTemplates = templateWorkouts.filter(
    (template: WorkoutTemplate) =>
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (template.notes &&
        template.notes.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  // sets selected template - toggles selection
  const handleSelectTemplate = (template: WorkoutTemplate) => {
    console.log(
      "📋 [UI] Template selected:",
      template.name,
      "ID:",
      template.id,
    );
    setSelectedTemplate(selectedTemplate?.id === template.id ? null : template);
    setWorkoutName(template.name);
  };

  // creates workout from selected template
  const handleAddWorkoutFromTemplate = () => {
    if (!selectedTemplate || !workoutName.trim()) return;

    console.log(
      "📋 [UI] Creating workout from template:",
      selectedTemplate.name,
      "as:",
      workoutName,
    );

    const exercises = selectedTemplate.workout_exercises.map((we) => {
      return {
        id: we.exercise.id,
        name: we.name,
        order: we.order,
        sets: we.sets.map((s) => ({
          set_number: s.set_number,
          prescribed_reps: s.prescribed_reps,
          prescribed_intensity: s.prescribed_intensity,
        })),
      };
    });

    onCreateWorkout(workoutName, workoutDate.toISOString(), exercises, true);
    console.log("📋 [UI] Template workout creation initiated");
    setSelectedTemplate(null);
    setSelectedExercises([]);
    setWorkoutName("");
    setWorkoutDate(new Date());
    setShowWorkoutForm(false);
  };

  // creates workout and closes modal
  const handleCreateWorkout = () => {
    if (!workoutName.trim()) return;

    console.log(
      "💪 [UI] Creating custom workout:",
      workoutName,
      "with",
      selectedExercises.length,
      "exercises",
    );

    // Convert selected exercises to the proper format with sets
    const exercises = selectedExercises.map((selectedExercise, index) => ({
      id: selectedExercise.exercise.id,
      name: selectedExercise.selectedTemplate.name,
      order: index + 1,
      sets: selectedExercise.selectedTemplate.sets.map((set: SetTemplate) => ({
        set_number: set.set_number,
        prescribed_reps: set.prescribed_reps,
        prescribed_intensity: set.prescribed_intensity,
      })),
    }));

    onCreateWorkout(workoutName, workoutDate.toISOString(), exercises, false);
    console.log("💪 [UI] Custom workout creation initiated");
    setWorkoutName("");
    setWorkoutDate(new Date());
    setSelectedExercises([]);
    setShowWorkoutForm(false);
  };

  // closes modal and clears state
  const handleCancel = () => {
    setWorkoutName("");
    setWorkoutDate(new Date());
    setSelectedExercises([]);
    setSelectedTemplate(null);
    setShowWorkoutForm(false);
    onClose();
  };

  // adds exercise to selected exercises
  const handleExerciseSelect = (
    exercise: ExerciseTemplate,
    selectedTemplate: { id: string; name: string; sets: SetTemplate[] },
  ) => {
    console.log(
      "🏋️ [UI] Exercise selected:",
      exercise.name,
      "with template:",
      selectedTemplate.name,
    );
    setSelectedExercises([
      ...selectedExercises,
      { exercise, selectedTemplate },
    ]);
  };

  // removes exercise from selected exercises
  const handleExerciseRemove = (exerciseId: string) => {
    console.log("🏋️ [UI] Exercise removed:", exerciseId);
    setSelectedExercises(
      selectedExercises.filter((ex) => ex.exercise.id !== exerciseId),
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <Screen edges={["top", "left", "right"]}>
        <View className="flex-row items-center justify-between border-b border-hairline px-6 py-4 dark:border-hairline-dark">
          <Pressable accessibilityRole="button" onPress={handleCancel}>
            <Text variant="label" tone="primary">
              Cancel
            </Text>
          </Pressable>
          <Text variant="label" tone="ink">
            {showWorkoutForm ? "New workout" : "Choose a template"}
          </Text>
          <View className="w-14" />
        </View>

        {!showWorkoutForm ? (
          <>
            <View className="gap-5 px-6 pt-6">
              <Input
                label="Workout name"
                value={workoutName}
                onChangeText={setWorkoutName}
                placeholder="Squat day"
              />
              <SheetRow
                label="Date"
                value={workoutDate.toLocaleDateString()}
                numeric
                chevron
                onPress={() => {
                  setTempDate(workoutDate);
                  setShowDateModal(true);
                }}
              />
              <Input
                label="Search templates"
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Filter by name or note"
              />
            </View>

            {/* Template list. Selection is a monochrome fill plus a check, so it
                can't be mistaken for the green primary action below. */}
            <ScrollView className="mt-4 flex-1 px-6">
              {templatesLoading ? (
                <View className="items-center py-10">
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : filteredTemplates.length === 0 ? (
                <View className="py-10">
                  <Text variant="body" tone="muted" className="text-center">
                    {searchQuery
                      ? "No template matches that search."
                      : "No templates saved yet."}
                  </Text>
                </View>
              ) : (
                filteredTemplates.map((item: WorkoutTemplate, i: number) => {
                  const isSelected = selectedTemplate?.id === item.id;
                  return (
                    <View key={item.id}>
                      {i > 0 ? (
                        <View className="h-px bg-hairline dark:bg-hairline-dark" />
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => handleSelectTemplate(item)}
                        className={`flex-row items-center justify-between py-4 ${
                          isSelected
                            ? "bg-surface-strong dark:bg-surface-strong-dark"
                            : "active:bg-surface dark:active:bg-surface-dark"
                        }`}
                      >
                        <View className="flex-1 gap-0.5 pr-3">
                          <Text variant="bodyStrong" tone="ink">
                            {item.name}
                          </Text>
                          {item.notes ? (
                            <Text variant="caption" tone="muted">
                              {item.notes}
                            </Text>
                          ) : null}
                        </View>
                        {isSelected ? (
                          <Check
                            size={18}
                            strokeWidth={2.5}
                            color={colors.ink}
                          />
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View className="px-6 pb-6 pt-4">
              {selectedTemplate ? (
                <Button
                  label="Add workout"
                  block
                  loading={isCreating}
                  disabled={isCreating}
                  onPress={handleAddWorkoutFromTemplate}
                />
              ) : (
                <Button
                  label="Create new workout"
                  variant="secondary"
                  block
                  onPress={() => {
                    setSelectedTemplate(null);
                    setShowWorkoutForm(true);
                    setWorkoutName("");
                  }}
                />
              )}
            </View>
          </>
        ) : (
          <ScrollView className="flex-1 px-6 pt-6">
            <View className="gap-5">
              <Input
                label="Workout name"
                value={workoutName}
                onChangeText={setWorkoutName}
                placeholder="Squat day"
              />
              <SheetRow
                label="Date"
                value={workoutDate.toLocaleDateString()}
                numeric
                chevron
                onPress={() => {
                  setTempDate(workoutDate);
                  setShowDateModal(true);
                }}
              />
            </View>

            {/* Exercise Selector */}
            <ExerciseSelector
              selectedExercises={selectedExercises}
              onExerciseSelect={handleExerciseSelect}
              onExerciseRemove={handleExerciseRemove}
            />

            <View className="py-6">
              <Button
                label="Create new workout"
                block
                loading={isCreating}
                disabled={isCreating}
                onPress={handleCreateWorkout}
              />
            </View>
          </ScrollView>
        )}

        {/* Date Picker Modal - Available for both template and custom workout views */}
        <Sheet
          visible={showDateModal}
          title="Date"
          onCancel={() => setShowDateModal(false)}
          onDone={() => {
            setWorkoutDate(tempDate);
            setShowDateModal(false);
          }}
        >
          <View className="w-full items-center">
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={(_, selectedDate) => {
                if (selectedDate) {
                  setTempDate(selectedDate);
                }
              }}
              minimumDate={new Date()}
              themeVariant={colorScheme === "dark" ? "dark" : "light"}
            />
          </View>
        </Sheet>
      </Screen>
    </Modal>
  );
}

export default function ProgramPage() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { user } = useAuth();
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);

  const queryClient = useQueryClient();

  // mutation handling for workout creation
  const createWorkoutMutation = useMutation({
    mutationFn: (body: {
      name: string;
      date: string;
      athlete_id: string | null;
      coach_id: string;
      exercises: {
        id: string;
        name: string;
        order: number;
        sets: ExerciseFormSet[];
      }[];
    }) => createWorkout(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts", athleteId] });
      setShowWorkoutModal(false);
    },
    onMutate: async (newWorkout) => {
      await queryClient.cancelQueries({ queryKey: ["workouts", athleteId] });
      const previous = queryClient.getQueryData(["workouts", athleteId]);

      queryClient.setQueryData(
        ["workouts", athleteId],
        (old: { id: string; name: string; date: string }[]) => [
          ...old,
          { ...newWorkout, id: "temp-" + Date.now() },
        ],
      );

      return { previous };
    },
    onError: (error, newWorkout, context) => {
      queryClient.setQueryData(["workouts", athleteId], context?.previous);
      console.error("Failed to create workout:", error);
    },
  });

  // fetching athlete profile
  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => fetchAthleteProfile(athleteId),
  });

  const handleCreateWorkout = (
    name: string,
    date: string,
    exercises: {
      id: string;
      name: string;
      order: number;
      notes?: string;
      sets: ExerciseFormSet[];
    }[],
  ) => {
    if (!name?.trim() || !user?.id || !athleteId) return;

    console.log("💪 [PARENT] Creating workout:", {
      name,
      date,
      exercise_count: exercises.length,
    });

    createWorkoutMutation.mutate({
      name,
      date,
      athlete_id: athleteId,
      coach_id: user.id,
      exercises,
    });
  };

  const handleModalClose = () => {
    setShowWorkoutModal(false);
  };

  const isOwnProgram = user?.id === athleteId;

  return (
    <Screen scroll>
      <View className="px-6 pt-4">
        <Text variant="title" tone="ink">
          {isOwnProgram
            ? "Your program"
            : `${athlete?.first_name} ${athlete?.last_name}`}
        </Text>
        {!isOwnProgram ? (
          <Text variant="body" tone="muted" className="mt-1">
            Programming
          </Text>
        ) : null}
      </View>

      <WeeklyWorkoutCard athleteId={athleteId} />

      {!isOwnProgram ? (
        <View className="px-6 pb-10 pt-8">
          <Button
            label="Add new workout"
            block
            onPress={() => setShowWorkoutModal(true)}
          />
        </View>
      ) : null}

      <WorkoutModal
        visible={showWorkoutModal}
        onClose={handleModalClose}
        onCreateWorkout={handleCreateWorkout}
        isCreating={createWorkoutMutation.isPending}
      />
    </Screen>
  );
}
