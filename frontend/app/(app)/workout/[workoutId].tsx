import { Button, DataTable, EmptyState, Input, QueryError, Screen, Section, Sheet, Text } from "@/components/ui";
import { ExerciseHistorySheet } from "@/components/ExerciseHistorySheet";
import {
  emptySet,
  ExerciseSetsEditor,
  toPrescribedSets,
} from "@/components/ExerciseSetsEditor";
import { useAuth } from "@/contexts/AuthContext";
import { addExerciseToWorkout } from "@/lib/api/exercises";
import { describeApiError } from "@/lib/api/client";
import { fetchWorkoutById, updateSet } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import {
  Exercise,
  ExerciseFormData,
  Set,
  Workout,
  WorkoutExercise,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Dumbbell, Plus } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  athleteId,
  onUpdateSet,
}: {
  exercise: Exercise;
  sets: Set[];
  workoutExercise: WorkoutExercise;
  /** The athlete performing this workout, or null on a template — a template has
   * no performer, so there is nothing to show a history of. */
  athleteId?: string | null;
  onUpdateSet: (set: Partial<Set>) => void;
}) {
  const [editingSet, setEditingSet] = useState<Set | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const rows = sets.map((set) => ({
    key: set.id,
    cells: {
      set: set.set_number,
      reps: set.prescribed_reps,
      // A percentage wins over hand-typed loads, matching the server. When
      // there is no max yet `resolved_load` is null and the percentage shows
      // alone — deliberately not zero, which would read as an empty barbell.
      load:
        set.prescribed_percent != null
          ? set.resolved_load != null
            ? `${Math.round(set.resolved_load * 10) / 10} · ${set.prescribed_percent}%`
            : `${set.prescribed_percent}%`
          : set.suggested_load_min
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

      {/* Reached without leaving the session being logged — the point of the sheet.
          Ghost rather than secondary: the action on this screen is logging a set,
          and a bordered button per exercise would compete with it. */}
      {athleteId ? (
        <View className="flex-row justify-end">
          <Button
            label="Last time"
            variant="ghost"
            onPress={() => setShowHistory(true)}
          />
        </View>
      ) : null}

      {editingSet ? (
        <SetModal
          isVisible
          onClose={() => setEditingSet(null)}
          set={editingSet}
          onSave={onUpdateSet}
        />
      ) : null}

      {/* Mounted only while open, the same way SetModal is. Section interleaves a
          hairline between its children, so a permanently mounted modal leaves a
          stray rule under every exercise. */}
      {showHistory && athleteId ? (
        <ExerciseHistorySheet
          visible
          onClose={() => setShowHistory(false)}
          exerciseId={exercise.id}
          exerciseName={exercise.name}
          athleteId={athleteId}
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
    sets: [emptySet()],
  });

  const handleSave = () => {
    onSave({ ...formData, sets: toPrescribedSets(formData.sets) });
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

        <ExerciseSetsEditor
          sets={formData.sets}
          onChange={(sets) => setFormData((prev) => ({ ...prev, sets }))}
        />
      </ScrollView>
    </Sheet>
  );
}

export default function WorkoutDetails() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const { user } = useAuth();

  const workoutKey = ["workout", workoutId];

  // fetching workout by id
  const {
    data: workout,
    isLoading,
    error: workoutError,
    refetch: refetchWorkout,
  } = useQuery<Workout>({
    queryKey: workoutKey,
    queryFn: () => fetchWorkoutById(workoutId),
  });

  /** Rewrites one set inside the cached workout, leaving everything else alone. */
  const patchCachedSet = (setId: string, patch: Partial<Set>) => {
    queryClient.setQueryData<Workout>(workoutKey, (old) => {
      if (!old) return old;

      return {
        ...old,
        workout_exercises: old.workout_exercises.map((we) => ({
          ...we,
          sets: we.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
        })),
      };
    });
  };

  /* Set logging is the app's most frequent action — 20+ times a session, on gym
     wifi, from a phone balanced on a bench. It has to land instantly and it has
     to be honest when it doesn't.

     Rollback is per-set rather than a whole-workout snapshot on purpose: an
     athlete tapping through a superset can have two saves in flight, and
     restoring a snapshot would silently discard the other one's edit. */
  const updateSetMutation = useMutation({
    mutationFn: (updatedSet: Set) => updateSet(updatedSet),
    onMutate: async (updatedSet) => {
      await queryClient.cancelQueries({ queryKey: workoutKey });

      const previous = queryClient
        .getQueryData<Workout>(workoutKey)
        ?.workout_exercises.flatMap((we) => we.sets)
        .find((s) => s.id === updatedSet.id);

      patchCachedSet(updatedSet.id, updatedSet);
      return { previous };
    },
    /* The server returns only the five columns it writes, so this merges rather
       than replaces — assigning the response would drop prescribed_reps and the
       resolved load off the set. */
    onSuccess: (saved) => {
      if (saved?.id) patchCachedSet(saved.id, saved);
    },
    onError: (error, updatedSet, context) => {
      if (context?.previous) patchCachedSet(updatedSet.id, context.previous);

      /* Without this the set stays on screen looking saved, and the athlete
         finds out it wasn't days later when their coach asks. */
      Alert.alert("Not saved", describeApiError(error, "Could not save that set."));
    },
  });

  // mutation handling for exercise creation
  const addExerciseMutation = useMutation({
    mutationFn: (exerciseData: ExerciseFormData) =>
      addExerciseToWorkout(exerciseData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workoutKey });
      setShowAddExerciseModal(false);
    },
    onMutate: async (newExercise) => {
      await queryClient.cancelQueries({ queryKey: workoutKey });
      const previousWorkout = queryClient.getQueryData<Workout>(workoutKey);

      queryClient.setQueryData<Workout>(workoutKey, (old) => {
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
        queryClient.setQueryData(workoutKey, context.previousWorkout);
      }
      Alert.alert("Not saved", describeApiError(error, "Could not add that exercise."));
    },
  });

  const handleUpdateSet = (updatedSet: Partial<Set>) => {
    updateSetMutation.mutate(updatedSet as Set);
  };

  const handleSaveExercise = (exerciseData: ExerciseFormData) => {
    if (!user) return;
    const exercise = {
      ...exerciseData,
      workout_id: workoutId,
      created_by: user?.id,
      order: workout?.workout_exercises?.length
        ? workout.workout_exercises.length + 1
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

  /* An athlete standing at the bar needs to know the difference between "this
     workout is empty" and "your phone could not reach the server". Before this
     they rendered the same. */
  if (workoutError) {
    return (
      <Screen>
        <QueryError
          error={workoutError}
          onRetry={() => void refetchWorkout()}
          fallback="Could not load this workout."
        />
      </Screen>
    );
  }

  const exercises = workout?.workout_exercises ?? [];

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
              // From the workout, not from useAuth: a coach reading this screen is
              // looking at their athlete's log, not their own.
              athleteId={workout?.athlete_id}
              onUpdateSet={handleUpdateSet}
            />
          ))
        )}
      </View>

      {/* No shadow: the green fill against canvas carries the elevation. */}
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
