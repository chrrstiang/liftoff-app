import { DataTable, EmptyState, Screen, Section, Text } from "@/components/ui";
import { fetchWorkoutById } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import { Workout, WorkoutExercise } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Dumbbell } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

/** The same columns as the logging screen, deliberately. A past session should
 * read as the session it was, not as a different table. */
const SET_COLUMNS = [
  { key: "set", label: "Set", width: 40 },
  { key: "reps", label: "Reps", width: 56 },
  { key: "load", label: "Load kg" },
  { key: "rpe", label: "RPE", width: 56 },
  { key: "actual", label: "Actual", width: 76 },
];

/** One exercise as it was performed. No `onPress` on any row — that is the whole
 * difference from the logging screen's card, and it is what makes this read-only.
 */
function PastExercise({
  workoutExercise,
}: {
  workoutExercise: WorkoutExercise;
}) {
  return (
    <Section label={workoutExercise.exercise.name} className="mt-8">
      {workoutExercise.notes ? (
        <Text variant="caption" tone="muted" className="pb-3">
          {workoutExercise.notes}
        </Text>
      ) : null}

      <DataTable
        columns={SET_COLUMNS}
        rows={workoutExercise.sets.map((set) => ({
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
        }))}
        emptyMessage="No sets prescribed"
      />
    </Section>
  );
}

/**
 * One past workout, read-only.
 *
 * A separate route from `/workout/[workoutId]` rather than a `readOnly` flag on
 * it. That screen owns set logging — a tappable row per set, an optimistic
 * mutation, a floating add-exercise button — and threading a mode through all of
 * that is how a screen ends up shipping an editable past session. Here nothing is
 * pressable, so there is nothing to get wrong.
 *
 * The record itself is unchanged: this reads the same `GET /workouts/:id` the
 * logging screen does, authorized the same way, and shares its query key so
 * opening a session twice costs one request.
 */
export default function PastWorkout() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const { colors } = useTheme();

  const {
    data: workout,
    isLoading,
    isError,
  } = useQuery<Workout>({
    queryKey: ["workout", workoutId],
    queryFn: () => fetchWorkoutById(workoutId),
    enabled: !!workoutId,
  });

  const exercises = workout?.workout_exercises ?? [];

  const totals = exercises.reduce(
    (running, exercise) => ({
      sets: running.sets + exercise.sets.length,
      completed:
        running.completed +
        exercise.sets.filter((set) => set.is_completed).length,
    }),
    { sets: 0, completed: 0 },
  );

  const header = (
    <View className="flex-row items-center gap-3 border-b border-hairline px-4 py-3 dark:border-hairline-dark">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={() => router.back()}
      >
        <ChevronLeft size={24} strokeWidth={2} color={colors.ink} />
      </Pressable>

      <Text variant="heading" tone="ink" className="flex-1" numberOfLines={1}>
        {workout?.name ?? "Workout"}
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <Screen edges={["top", "left", "right"]}>
        {header}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (isError || !workout) {
    return (
      <Screen edges={["top", "left", "right"]}>
        {header}
        <View className="flex-1 py-16">
          <EmptyState
            icon={Dumbbell}
            title="Workout unavailable"
            body="This session could not be loaded. It may have been deleted by your coach."
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      {header}

      {/* The ScrollView is here rather than `Screen scroll` so the header stays
          pinned instead of scrolling away with the sets. */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-6 pb-16">
          <View className="gap-1 pt-6">
            <Text variant="overline" tone="muted">
              {format(parseISO(workout.date), "EEEE, MMMM d, yyyy")}
            </Text>
            <Text variant="caption" tone="muted">
              {totals.sets > 0
                ? `${totals.completed} of ${totals.sets} sets completed`
                : "No sets were prescribed for this session"}
            </Text>
          </View>

          {workout.notes ? (
            <View className="mt-6 rounded-card border-l-2 border-primary bg-surface p-4 dark:border-primary-dark dark:bg-surface-dark">
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
                title="No exercises"
                body="Nothing was ever added to this session."
              />
            </View>
          ) : (
            exercises.map((workoutExercise) => (
              <PastExercise
                key={workoutExercise.id}
                workoutExercise={workoutExercise}
              />
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
