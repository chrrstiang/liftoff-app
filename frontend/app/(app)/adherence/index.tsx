import { Button, EmptyState, Screen, Section, Text } from "@/components/ui";
import { fetchAdherence } from "@/lib/api/adherence";
import { describeApiError } from "@/lib/api/client";
import { useTheme } from "@/theme/useTheme";
import type { AdherenceRow } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Users } from "lucide-react-native";
import { ActivityIndicator, Pressable, View } from "react-native";

/** Who on the coach's roster is actually doing the work.
 *
 * The coach's reason to open the app on a day they are not programming. Without
 * it, a coach finds out an athlete stopped training by asking them.
 *
 * **Worst adherence first**, ordered server-side. A coach opens this to find who
 * needs attention, so the answer belongs at the top rather than behind a scroll.
 */
export default function AdherenceScreen() {
  const { colors } = useTheme();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["adherence"],
    queryFn: () => fetchAdherence(),
  });

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: "Adherence", headerShown: true }} />

      <View className="px-6 pt-4">
        <Text variant="caption" tone="muted">
          Sets completed over the last four weeks, worst first. A set counts once
          the athlete marks it done.
        </Text>
      </View>

      {isLoading ? (
        <View className="py-16">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        /* A failed read renders as an error, not as an empty roster. Showing
           "no athletes" to a coach with seventeen would be a confident lie. */
        <View className="min-h-72 flex-1 items-center justify-center gap-4 px-6 py-16">
          <Text variant="body" tone="muted" className="text-center">
            {describeApiError(error, "Could not load adherence.")}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : data && data.length > 0 ? (
        <Section label="Roster" className="mt-8 px-6">
          {data.map((row) => (
            <Pressable
              key={row.athlete_id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${row.first_name} ${row.last_name}`}
              onPress={() => router.push(`/roster/${row.athlete_id}`)}
              className="border-t border-hairline py-4 active:opacity-60 dark:border-hairline-dark"
            >
              <View className="flex-row items-baseline justify-between">
                <Text variant="body" tone="ink" className="flex-1 pr-4">
                  {row.first_name} {row.last_name}
                </Text>
                <Text variant="body" tone="ink">
                  {summary(row)}
                </Text>
              </View>
              <Text variant="caption" tone="muted" className="mt-1">
                {detail(row)}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : (
        <View className="min-h-72 flex-1 py-16">
          <EmptyState
            icon={Users}
            title="No athletes yet"
            body="Invite athletes from the Roster tab and their adherence will show up here."
          />
        </View>
      )}
    </Screen>
  );
}

/** An athlete with nothing prescribed has no adherence to report — showing "0%"
 * would blame them for the coach's own omission. */
function summary(row: AdherenceRow): string {
  if (row.sets_prescribed === 0) return "—";
  return `${Math.round((row.sets_completed / row.sets_prescribed) * 100)}%`;
}

function detail(row: AdherenceRow): string {
  if (row.sets_prescribed === 0) return "Nothing programmed in this window";

  // Always report started-of-assigned, including when only one is assigned.
  // Collapsing that case to "1 session" dropped exactly the signal this screen
  // exists for: an athlete with one workout and nothing logged read as
  // "1 session" rather than "0 of 1 sessions started".
  const noun = row.workouts_assigned === 1 ? "session" : "sessions";

  return `${row.sets_completed} of ${row.sets_prescribed} sets · ${row.workouts_started} of ${row.workouts_assigned} ${noun} started`;
}
