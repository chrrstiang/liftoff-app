import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  useColorScheme,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWorkout, fetchAthleteWorkouts } from "@/lib/api/workouts";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";

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
          {workoutData.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-center text-gray-500 dark:text-gray-400">
                No workouts found
              </Text>
            </View>
          ) : (
            workoutData?.map(
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
            )
          )}
        </View>
      </View>
    </View>
  );
};

function NewWorkoutForm({
  onCancel,
  onSubmit,
  isCreating,
}: {
  onCancel: () => void;
  onSubmit: (name: string, date: string) => void;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(new Date());
  const [tempDate, setTempDate] = useState(new Date());
  const [showDateModal, setShowDateModal] = useState(false);
  const colorScheme = useColorScheme();

  return (
    <View className="bg-white dark:bg-zinc-900 rounded-xl p-4 mx-6 mb-4 shadow-sm">
      <Text className="text-lg font-semibold text-foreground dark:text-white mb-4">
        New Workout
      </Text>

      <View className="mb-4">
        <Text className="text-sm text-gray-600 dark:text-gray-300 mb-1">
          Workout Name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Enter workout name"
          className="bg-gray-100 dark:bg-zinc-800 rounded-lg p-3 text-foreground dark:text-white"
          placeholderTextColor="#9ca3af"
        />
      </View>

      <View>
        <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
          Date
        </Text>
        <TouchableOpacity
          onPress={() => {
            setTempDate(date);
            setShowDateModal(true);
          }}
          className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Text className="dark:text-white">{date.toLocaleDateString()}</Text>
        </TouchableOpacity>
        <Modal
          visible={showDateModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowDateModal(false)}
        >
          <View className="flex-1 justify-end bg-black/50">
            <View className="bg-white dark:bg-zinc-800 rounded-t-2xl p-6">
              <View className="flex-row justify-between items-center mb-4">
                <TouchableOpacity onPress={() => setShowDateModal(false)}>
                  <Text className="text-blue-500 text-lg">Cancel</Text>
                </TouchableOpacity>
                <Text className="text-lg font-semibold dark:text-white">
                  Select Date
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setDate(tempDate);
                    setShowDateModal(false);
                  }}
                >
                  <Text className="text-blue-500 text-lg font-semibold">
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <View className="w-full items-center">
                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display="spinner"
                  onChange={(_, selectedDate) => {
                    if (selectedDate) {
                      setTempDate(selectedDate);
                    }
                  }}
                  minimumDate={new Date()}
                  themeVariant={colorScheme === "dark" ? "dark" : "light"}
                />
              </View>
            </View>
          </View>
        </Modal>
      </View>

      <View className="flex-row justify-end space-x-2">
        <TouchableOpacity
          onPress={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-zinc-700"
        >
          <Text className="text-foreground dark:text-white">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onSubmit(name, date.toISOString())}
          className="bg-green-500 dark:bg-green-700 px-4 py-2 rounded-lg"
          disabled={!name || isCreating || !date}
        >
          <Text className="text-white font-medium">Create Workout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ProgramPage() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { user } = useAuth();
  const [showNewWorkoutForm, setShowNewWorkoutForm] = useState(false);

  const queryClient = useQueryClient();

  const createWorkoutMutation = useMutation({
    mutationFn: (body: {
      name: string;
      date: string;
      athlete_id: string;
      coach_id: string;
    }) => createWorkout(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts", athleteId] });
      setShowNewWorkoutForm(false);
    },
    onMutate: async (newWorkout) => {
      await queryClient.cancelQueries({ queryKey: ["workouts", athleteId] });
      const previous = queryClient.getQueryData(["workouts", athleteId]);

      queryClient.setQueryData(
        ["workouts", athleteId],
        (old: { id: string; name: string; date: string }[]) => [
          ...old,
          { ...newWorkout, id: "temp-" + Date.now() },
        ]
      );

      return { previous };
    },
    onError: (error, newWorkout, context) => {
      queryClient.setQueryData(["workouts", athleteId], context?.previous);
      console.error("Failed to create workout:", error);
    },
  });

  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => fetchAthleteProfile(athleteId),
  });

  const handleCreateWorkout = async (name: string, date: string) => {
    if (!name.trim() || !user?.id) return;

    const body = { name, date, athlete_id: athleteId, coach_id: user.id };

    createWorkoutMutation.mutate(body);
  };

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <ScrollView className="flex-1">
        <Text className="text-3xl dark:text-white font-bold px-6 pt-6 pb-2">
          {user?.id === athleteId
            ? "Your Program"
            : `${athlete?.first_name} ${athlete?.last_name}'s program`}
        </Text>
        <WeeklyWorkoutCard athleteId={athleteId} />
        {user?.id !== athleteId && (
          <View className="px-6 mt-4 mb-8">
            {showNewWorkoutForm ? (
              <NewWorkoutForm
                onCancel={() => setShowNewWorkoutForm(false)}
                onSubmit={handleCreateWorkout}
                isCreating={createWorkoutMutation.isPending}
              />
            ) : (
              <TouchableOpacity
                onPress={() => setShowNewWorkoutForm(true)}
                className="bg-green-500 dark:bg-green-700 rounded-xl p-4 items-center"
              >
                <Text className="text-white font-medium">Add New Workout</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
