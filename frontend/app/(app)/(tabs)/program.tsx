import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { router } from "expo-router";

type WorkoutName = {
  id: string;
  name: string;
  date: string;
};

const WeeklyWorkoutCard = () => {
  const { session } = useAuth();

  const [workouts, setWorkouts] = useState<WorkoutName[]>([]);
  useEffect(() => {
    const fetchWeek = async () => {
      const { data, error } = await supabase
        .from("workouts")
        .select("id, name, date")
        .eq("athlete_id", session?.user.id)
        .order("date");

      if (!data || error) {
        console.error("Error fetching workouts: ", error);
        throw new Error("Failed to fetch workouts");
      }

      setWorkouts(data);
    };
    fetchWeek();
  }, [session?.user.id]);

  const getCurrentDayName = () => {
    const dateName = new Date().toLocaleDateString("en-US", {
      weekday: "long",
    });
    return dateName;
  };

  return (
    <View className="w-full p-4">
      <View className="bg-white rounded-xl shadow-md p-6 mb-4">
        <Text className="text-2xl font-bold text-center mb-4">Week 1</Text>
        <View className="space-y-3">
          {workouts.map(({ id, name, date }, index) => (
            <TouchableOpacity
              key={id}
              onPress={() => {
                console.log("Directing to workout", id);
                router.push(`/workout/${id}`);
              }}
            >
              <View
                className={`flex-row justify-between items-center p-4 rounded-lg ${
                  index % 2 === 0 ? "bg-gray-50" : "bg-white"
                }`}
              >
                <Text className="text-lg font-medium flex-1">{name}</Text>
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
          ))}
        </View>
      </View>
    </View>
  );
};

export default function ProgramPage() {
  return (
    <View className="flex-1 bg-gray-100">
      <ScrollView className="flex-1">
        <Text className="text-3xl font-bold px-6 pt-6 pb-2">Your Program</Text>
        <WeeklyWorkoutCard />
      </ScrollView>
    </View>
  );
}
