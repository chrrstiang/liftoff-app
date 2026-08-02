import { NotificationModal } from "@/components/NotificationModal";
import { Button, EmptyState, Screen, Section, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAthleteRequests } from "@/lib/api/notifications";
import { fetchAthleteWorkouts } from "@/lib/api/workouts";
import { useTheme } from "@/theme/useTheme";
import { CoachRequest } from "@/types/types";
import { useQuery } from "@tanstack/react-query";
import { format, isToday, isTomorrow, parseISO, startOfToday } from "date-fns";
import { router } from "expo-router";
import { Bell, CalendarDays } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

/* Home page tab */
export default function HomePage() {
  const { profile, user } = useAuth();
  const { colors } = useTheme();

  const [showNotifications, setShowNotifications] = useState(false);

  // fetching workouts of athlete
  const { data: workouts } = useQuery({
    queryKey: ["workouts", user?.id],
    queryFn: () => fetchAthleteWorkouts(user!.id),
  });

  // fetching requests of athlete
  const { data: requests } = useQuery<CoachRequest[]>({
    queryKey: ["requests", user?.id],
    queryFn: () => fetchAthleteRequests(user!.id),
  });

  // workout to display on card
  const nextWorkout = workouts
    ?.filter((workout) => {
      const workoutDate = parseISO(workout.date);
      return workoutDate >= startOfToday();
    })
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())[0];

  const getWorkoutDateText = (dateString: string) => {
    const date = parseISO(dateString);
    if (isToday(date)) return "Today's Workout";
    if (isTomorrow(date)) return "Tomorrow's Workout";
    return `Workout on ${format(date, "EEEE, MMMM d")}`;
  };

  return (
    <Screen scroll>
      <View className="flex-row items-start justify-between px-6 pt-4">
        <Text variant="title" tone="ink" className="flex-1 pr-4">
          Welcome back, {profile?.first_name || "Athlete"}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            requests && requests.length > 0
              ? `Notifications, ${requests.length} pending`
              : "Notifications"
          }
          hitSlop={8}
          onPress={() => setShowNotifications(true)}
          className="relative mt-1"
        >
          <Bell
            size={24}
            strokeWidth={2}
            color={showNotifications ? colors.primary : colors.muted}
          />
          {/* Ink fill with canvas text, so the count stays legible in both
              themes. Coral is reserved for actions and a badge isn't one. */}
          {requests && requests.length > 0 ? (
            <View className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 dark:bg-ink-dark">
              <Text variant="overline" tone="onInk">
                {requests.length}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {nextWorkout ? (
        <Section label="Up next" className="mt-8 px-6">
          <View className="gap-1 py-4">
            <Text variant="overline" tone="muted">
              {getWorkoutDateText(nextWorkout.date)}
            </Text>
            <Text variant="title" tone="ink">
              {nextWorkout.name}
            </Text>
            <Text variant="caption" tone="muted">
              {format(parseISO(nextWorkout.date), "MMMM d, yyyy")}
            </Text>
          </View>

          <Button
            label="Log workout"
            block
            onPress={() => router.push(`/workout/${nextWorkout.id}`)}
            className="mb-2 mt-2"
          />
        </Section>
      ) : (
        <View className="min-h-72 flex-1 py-16">
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled"
            body="When your coach assigns a workout, it shows up here."
          />
        </View>
      )}

      <NotificationModal
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        requests={requests || []}
        userId={user!.id}
      />
    </Screen>
  );
}
