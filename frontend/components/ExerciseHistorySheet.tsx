import { DataTable, Sheet, Text } from "@/components/ui";
import { fetchExerciseHistory } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

/** How many past sessions one open of the sheet pulls. Deliberately short: this
 * answers "what did I do last time", and a lifter scrolling twelve sessions deep
 * wants the history screen, not a popover over the set they are mid-way through
 * logging. */
const SESSIONS_SHOWN = 8;

/** The history columns. Narrower than the logging screen's attempt sheet — the
 * prescription is on the page behind this one, so only what was performed earns a
 * column here. */
const HISTORY_COLUMNS = [
  { key: "set", label: "Set", width: 40 },
  { key: "reps", label: "Reps", width: 56 },
  { key: "load", label: "Load kg" },
  { key: "rpe", label: "RPE", width: 56 },
];

export interface ExerciseHistorySheetProps {
  visible: boolean;
  onClose: () => void;
  /** The library exercise, not the `workout_exercises` row. */
  exerciseId: string;
  exerciseName: string;
  /** Who performed the sets. The workout's athlete, never the signed-in user —
   * a coach opening this is looking at somebody else's log. */
  athleteId: string;
}

/**
 * What this lift has looked like, without leaving the workout being logged.
 *
 * The whole point is not navigating away: a lifter deciding what to load for set
 * two should not have to abandon a half-logged session to find out what they did
 * last week. So this is a sheet over the logging screen rather than a route.
 *
 * The query is gated on `visible`, so opening a workout does not fetch history for
 * every exercise in it — on an eight-exercise session that would be eight requests
 * nobody asked for.
 */
export function ExerciseHistorySheet({
  visible,
  onClose,
  exerciseId,
  exerciseName,
  athleteId,
}: ExerciseHistorySheetProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["exerciseHistory", exerciseId, athleteId],
    queryFn: () =>
      fetchExerciseHistory(exerciseId, {
        athleteId,
        limit: SESSIONS_SHOWN,
      }),
    enabled: visible,
  });

  const sessions = data?.sessions ?? [];

  return (
    <Sheet
      visible={visible}
      title={exerciseName}
      onCancel={onClose}
      onDone={onClose}
      doneLabel="Done"
    >
      {/* Proportional to the viewport, matching SelectSheet. A `vh` class compiles
          on web and is silently ignored on device. */}
      <ScrollView style={{ maxHeight: height * 0.6 }} className="px-4">
        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError ? (
          <View className="py-12">
            <Text variant="body" tone="muted" className="text-center">
              This exercise&apos;s history could not be loaded.
            </Text>
          </View>
        ) : sessions.length === 0 ? (
          <View className="py-12">
            {/* Phrased for either reader. A coach opening this sees only the
                sessions they programmed, so "once you log this" would be wrong
                for them — see historyVisibilityFilter on the API side. */}
            <Text variant="body" tone="muted" className="text-center">
              Nothing logged against this lift yet. Past sets show up here once a
              session with it has been completed.
            </Text>
          </View>
        ) : (
          sessions.map((session, i) => {
            const rows = session.sets.map((set) => ({
              key: set.id,
              cells: {
                set: set.set_number,
                reps: set.prescribed_reps,
                load: set.actual_load,
                rpe: set.actual_intensity ?? set.prescribed_intensity,
              },
              // The logged load is the answer being looked for, so it carries the
              // accent while the prescription stays in body tone.
              emphasis: set.actual_load ? ["load"] : undefined,
            }));

            // The heaviest thing actually lifted that day — the one number worth
            // reading before the table.
            const topLoad = session.sets.reduce(
              (heaviest, set) => Math.max(heaviest, set.actual_load ?? 0),
              0,
            );

            return (
              <View
                key={session.workout_id}
                className={
                  i > 0
                    ? "border-t border-hairline pt-4 dark:border-hairline-dark"
                    : ""
                }
              >
                <View className="flex-row items-baseline justify-between pb-2 pt-4">
                  <Text variant="overline" tone="muted">
                    {format(parseISO(session.date), "EEE d MMM yyyy")}
                  </Text>
                  {topLoad > 0 ? (
                    <Text variant="caption" tone="muted">
                      Top {topLoad} kg
                    </Text>
                  ) : null}
                </View>

                <View className="pb-4">
                  <DataTable
                    columns={HISTORY_COLUMNS}
                    rows={rows}
                    emptyMessage="Nothing logged this session"
                  />
                </View>
              </View>
            );
          })
        )}

        {data?.has_more ? (
          <Text variant="caption" tone="muted" className="pb-4 text-center">
            Showing the last {SESSIONS_SHOWN} sessions. Open History for the rest.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
