import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { fetchAthleteWorkouts } from "@/lib/api/workouts";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { useAuth } from "@/contexts/AuthContext";

const WeeklyWorkoutCard = ({ athleteId }: { athleteId: string }) => {
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
      <SafeAreaView className="flex-1 items-center justify-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <View className="w-full p-4 bg-background dark:bg-zinc-950">
      <View className="bg-background dark:bg-zinc-900 rounded-xl shadow-md p-6 mb-4">
        <Text className="text-2xl dark:text-white font-bold text-center mb-4">
          Week 1
        </Text>
        <View className="space-y-3">
          {workoutData?.map(
            (
              { id, name, date }: { id: string; name: string; date: string },
              index: number
            ) => (
              <TouchableOpacity
                key={id}
                onPress={() => {
                  console.log("Directing to workout", id);
                  router.push(`/workout/${id}`);
                }}
              >
                <View
                  className={`flex-row justify-between items-center p-4 rounded-lg ${
                    index % 2 === 0
                      ? "bg-gray-50 dark:bg-zinc-700"
                      : "bg-background dark:bg-zinc-800"
                  }`}
                >
                  <Text className="text-lg font-medium flex-1 dark:text-white">
                    {name}
                  </Text>
                  {getCurrentDayName() ===
                    new Date(date).toLocaleDateString("en-US", {
                      weekday: "long",
                    }) && (
                    <View className="bg-green-100 px-2 py-1 rounded-full ml-2">
                      <Text className="text-green-800 text-xs font-medium">
                        TODAY
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    </View>
  );
};

export default function ProgramPage() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { user } = useAuth();

  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => fetchAthleteProfile(athleteId),
  });

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <ScrollView className="flex-1">
        <Text className="text-3xl dark:text-white font-bold px-6 pt-6 pb-2">
          {user?.id === athleteId
            ? "Your Program"
            : `${athlete?.first_name} ${athlete?.last_name}'s program`}
        </Text>
        <WeeklyWorkoutCard athleteId={athleteId} />
      </ScrollView>
    </SafeAreaView>
  );
}
