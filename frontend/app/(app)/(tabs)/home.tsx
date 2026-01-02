import { SafeAreaView } from "react-native-safe-area-context";
import { Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { fetchAthleteWorkouts } from "@/lib/api/workouts";
import { format, isToday, isTomorrow, parseISO, startOfToday } from "date-fns";
import { router } from "expo-router";
import { fetchAthleteRequests } from "@/lib/api/notifications";
import { Bell } from "lucide-react-native";
import { NotificationModal } from "@/components/NotificationModal";
import { useState } from "react";
import { CoachRequest } from "@/types/types";

/* Home page tab */
export default function HomePage() {
  const { profile, user } = useAuth();

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
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950 p-4">
      <View className="flex-row justify-between items-center mb-6">
        <Text className="text-3xl font-bold text-foreground dark:text-white">
          Welcome back, {profile?.first_name || "Athlete"}
        </Text>
        <TouchableOpacity
          onPress={() => setShowNotifications(true)}
          className="relative"
        >
          <Bell size={24} color={showNotifications ? "#8b5cf6" : "#6b7280"} />
          {requests && requests.length > 0 && (
            <View className="absolute -top-1 -right-1 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
              <Text className="text-white text-xs">{requests.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {nextWorkout ? (
        <View className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm">
          <Text className="text-lg font-semibold text-foreground dark:text-white mb-1">
            {getWorkoutDateText(nextWorkout.date)}
          </Text>
          <Text className="text-muted-foreground dark:text-gray-300 text-sm mb-4">
            {format(parseISO(nextWorkout.date), "MMMM d, yyyy")}
          </Text>
          <Text className="text-2xl font-bold text-foreground dark:text-white mb-6">
            {nextWorkout.name}
          </Text>
          <TouchableOpacity
            onPress={() => router.push(`/workout/${nextWorkout.id}`)}
            className="bg-violet-500 dark:bg-violet-700 py-3 rounded-lg items-center"
          >
            <Text className="text-white font-medium">Log Workout</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="bg-white dark:bg-zinc-800 rounded-xl p-6 items-center">
          <Text className="text-foreground dark:text-white text-lg mb-2">
            No upcoming workouts
          </Text>
          <Text className="text-muted-foreground dark:text-gray-400 text-center mb-4">
            You do not have any scheduled workouts. Check back later or contact
            your coach.
          </Text>
        </View>
      )}
      <NotificationModal
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        requests={requests || []}
        userId={user!.id}
      />
    </SafeAreaView>
  );
}
