import { Button, Input, Text } from "@/components/ui";
import type { ExerciseFormSet } from "@/types";
import { View } from "react-native";

/** One empty set row. Exported because both callers need to seed their state
 * with one — an exercise with zero sets is a row the UI renders and nobody can
 * complete, and `POST /workouts` rejects it anyway. */
export function emptySet(): ExerciseFormSet {
  return {
    prescribed_reps: null,
    prescribed_intensity: null,
    prescribed_percent: null,
    suggested_load_min: null,
    suggested_load_max: null,
  };
}

/** Normalises what the inputs hold (strings) into what the API takes (numbers or
 * null), and stamps `set_number` from position.
 *
 * ⚠️ **`prescribed_reps` is bare `Number(...)`, deliberately not `|| null`.**
 * `PrescribedSetDto.prescribed_reps` is `@IsInt() @Min(0)` and **not**
 * `@IsOptional()`, so `null` is a 400. A blank Reps field holds `null` in state,
 * and `Number(null)` is `0` — which the API accepts. Sending `null` instead would
 * turn an RPE-only or percentage-only prescription, typed with no rep count, into
 * a failed save. That is the exact shape `SetTemplate`'s own comment describes
 * ("5x3 @ 75%"), and nothing gates the Save button on reps being present.
 *
 * Zero prescribed reps is its own data-quality problem, and it predates this —
 * but it is a different fix from unblocking the builder, and making it a 400 here
 * would break a path that works today.
 *
 * ⚠️ **The optional fields are `|| null`, not `?? null`.** An empty string and a
 * typed `0` both mean "no value here", and `Number("")` is `0` — so `??` would
 * send a real zero for every field the coach left blank.
 *
 * `set_number` comes from the array index at save time rather than from whatever
 * a preset carried, so a coach who removes the middle set of three does not
 * submit 1, 3 — which `assertDistinctSetNumbers` accepts and the athlete then
 * reads as a missing set.
 */
export function toPrescribedSets(sets: ExerciseFormSet[]): ExerciseFormSet[] {
  return sets.map((set, index) => ({
    prescribed_reps: Number(set.prescribed_reps),
    prescribed_intensity: set.prescribed_intensity || null,
    prescribed_percent: Number(set.prescribed_percent) || null,
    suggested_load_min: Number(set.suggested_load_min) || null,
    suggested_load_max: Number(set.suggested_load_max) || null,
    set_number: index + 1,
  }));
}

export interface ExerciseSetsEditorProps {
  sets: ExerciseFormSet[];
  onChange: (sets: ExerciseFormSet[]) => void;
}

/**
 * The prescription editor — reps, RPE, percentage, load range — for one exercise.
 *
 * Lifted out of `AddExerciseModal` so the program builder can use the same one.
 * Before this, the builder could only attach sets that came from a saved exercise
 * template, and nothing in the app ever created one of those. So the picker was
 * always empty, `selectedExercises` could never be non-empty, and
 * `CreateWorkoutDto.exercises` has `@ArrayMinSize(1)` — meaning **a coach on a
 * fresh account could not create a workout at all**. This component is what makes
 * saved defaults a shortcut rather than a gate.
 *
 * Stateless on purpose: the parent owns the array, because one caller keeps it in
 * a form object alongside a name and the other keeps it per selected exercise.
 */
export function ExerciseSetsEditor({ sets, onChange }: ExerciseSetsEditorProps) {
  const updateSet = (
    index: number,
    field: keyof ExerciseFormSet,
    value: string | number | null,
  ) => {
    onChange(sets.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  return (
    <>
      <View className="flex-row items-center justify-between border-t border-hairline pt-4 dark:border-hairline-dark">
        <Text variant="overline" tone="muted">
          Sets
        </Text>
        <Button
          label="Add set"
          variant="ghost"
          onPress={() => onChange([...sets, emptySet()])}
        />
      </View>

      {sets.map((set, index) => (
        <View
          key={index}
          className="gap-3 border-t border-hairline py-4 dark:border-hairline-dark"
        >
          <View className="flex-row items-center justify-between">
            <Text variant="label" tone="ink">
              Set {index + 1}
            </Text>
            {/* Never offer to remove the last one: zero sets is not a state the
                API accepts. */}
            {sets.length > 1 ? (
              <Button
                label="Remove"
                variant="danger"
                onPress={() => onChange(sets.filter((_, i) => i !== index))}
              />
            ) : null}
          </View>

          <View className="flex-row gap-2">
            <Input
              label="Reps"
              className="flex-1"
              value={set.prescribed_reps ? set.prescribed_reps.toString() : ""}
              onChangeText={(text) =>
                updateSet(index, "prescribed_reps", text || null)
              }
              placeholder="12"
              keyboardType="number-pad"
            />
            <Input
              label="RPE"
              className="flex-1"
              value={set.prescribed_intensity ? set.prescribed_intensity : ""}
              onChangeText={(text) =>
                updateSet(index, "prescribed_intensity", text || null)
              }
              placeholder="7"
            />
          </View>

          {/* A percentage and hand-typed loads are alternatives, not a pair —
              the server takes the percentage when both are present. Kept as a
              full-width row above them so it reads as the choice it is rather
              than a third load field. */}
          <Input
            label="% of max"
            value={
              set.prescribed_percent ? set.prescribed_percent.toString() : ""
            }
            onChangeText={(text) =>
              updateSet(index, "prescribed_percent", text || null)
            }
            placeholder="75"
            keyboardType="decimal-pad"
          />

          <View className="flex-row gap-2">
            <Input
              label="Load min"
              className="flex-1"
              value={
                set.suggested_load_min ? set.suggested_load_min.toString() : ""
              }
              onChangeText={(text) =>
                updateSet(index, "suggested_load_min", text || null)
              }
              placeholder="0"
              keyboardType="number-pad"
            />
            <Input
              label="Load max"
              className="flex-1"
              value={
                set.suggested_load_max ? set.suggested_load_max.toString() : ""
              }
              onChangeText={(text) =>
                updateSet(index, "suggested_load_max", text || null)
              }
              placeholder="0"
              keyboardType="number-pad"
            />
          </View>
        </View>
      ))}
    </>
  );
}
