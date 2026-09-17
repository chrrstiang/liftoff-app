import { EmptyState, Numeral, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWorkoutHistory } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import { WorkoutHistoryEntry } from "@/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";

/** FlatList's contentContainerStyle takes a style object, not a className. */
const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
});

/** One request's worth of sessions. Twenty is a month of training for most
 * people, which is as far as anyone scrolls before reaching for a date. */
const PAGE_SIZE = 20;

/** One past session as a ruled row: the date as a numeral on the left, what it was
 * and how much of it got done on the right. */
function HistoryRow({ workout }: { workout: WorkoutHistoryEntry }) {
  const { colors } = useTheme();
  const date = parseISO(workout.date);

  const summary = [
    `${workout.exercise_count} ${workout.exercise_count === 1 ? "exercise" : "exercises"}`,
    workout.set_count > 0
      ? `${workout.completed_set_count} of ${workout.set_count} sets`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${workout.name}, ${format(date, "d MMMM yyyy")}`}
      onPress={() => router.push(`/history/workout/${workout.id}`)}
      className="flex-row items-center gap-4 px-6 py-4 active:bg-surface dark:active:bg-surface-dark"
    >
      {/* Fixed-width so the dates form a column the eye can run down, rather
          than jogging left and right with the length of each month. */}
      <View className="w-14 items-center">
        <Numeral size="title">{format(date, "d")}</Numeral>
        <Text variant="overline" tone="muted">
          {format(date, "MMM")}
        </Text>
      </View>

      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" tone="ink" numberOfLines={1}>
          {workout.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {summary}
        </Text>
      </View>

      <ChevronRight size={18} strokeWidth={2} color={colors.muted} />
    </Pressable>
  );
}

/**
 * Past workouts, newest first.
 *
 * ⚠️ **This screen is the reason the feature exists.** Home filters workouts to
 * `date >= today`, so it only ever shows the *next* session — every workout an
 * athlete completed became unreachable the following day, even though all of it
 * was in the database the whole time.
 *
 * The route is `[athleteId]` rather than an implicit "me" so a coach can open the
 * same screen for someone on their roster. The API authorizes the id against the
 * token and 404s a caller with no claim on it, so the parameter cannot be used to
 * read a stranger's training.
 */
export default function WorkoutHistoryScreen() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();

  const {
    data,
    isLoading,
    isError,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["workoutHistory", athleteId],
    queryFn: ({ pageParam }) =>
      fetchWorkoutHistory({ athleteId, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    // `has_more` comes from the server rather than being inferred from a short
    // page — the last page is full as often as not, and guessing from the length
    // means one wasted request every time it is.
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
    enabled: !!athleteId,
  });

  const workouts = data?.pages.flatMap((page) => page.workouts) ?? [];
  const isOwnHistory = athleteId === user?.id;

  return (
    <Screen edges={["top", "left", "right"]}>
      <View className="flex-row items-center gap-3 border-b border-hairline px-4 py-3 dark:border-hairline-dark">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} strokeWidth={2} color={colors.ink} />
        </Pressable>

        <Text variant="heading" tone="ink" className="flex-1">
          History
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={workouts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <HistoryRow workout={item} />}
          ItemSeparatorComponent={() => (
            <View className="ml-24 h-px bg-hairline dark:bg-hairline-dark" />
          )}
          contentContainerStyle={workouts.length === 0 ? styles.grow : undefined}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            // Guarded: FlatList fires this more than once per scroll, and an
            // unguarded call requests the same page repeatedly.
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={() => void refetch()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-6">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="flex-1 py-16">
              <EmptyState
                icon={CalendarCheck}
                title={isError ? "History unavailable" : "Nothing logged yet"}
                body={
                  isError ?
                    "These workouts could not be loaded. Pull to try again."
                  : isOwnHistory ?
                    "Once a workout's date has passed, it moves here so you can look back at what you lifted."
                  : "This athlete has no completed workouts yet. Sessions appear here the day after they are scheduled."
                }
              />
            </View>
          }
        />
      )}
    </Screen>
  );
}
