import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  useColorScheme,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWorkout, fetchAthleteWorkouts } from "@/lib/api/workouts";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import ExerciseSelector from "@/components/ExerciseSelector";

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
                index: number,
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
              ),
            )
          )}
        </View>
      </View>
    </View>
  );
};

// Dummy template workout data
const TEMPLATE_WORKOUTS = [
  {
    id: "1",
    name: "Upper Body Strength",
    description: "Chest, back, shoulders, and arms",
    category: "Strength",
  },
  {
    id: "2",
    name: "Lower Body Power",
    description: "Squats, deadlifts, and explosive movements",
    category: "Power",
  },
  {
    id: "3",
    name: "HIIT Cardio",
    description: "High intensity interval training",
    category: "Cardio",
  },
  {
    id: "4",
    name: "Core & Stability",
    description: "Core strengthening and balance work",
    category: "Core",
  },
  {
    id: "5",
    name: "Full Body Circuit",
    description: "Complete body workout in circuit format",
    category: "Full Body",
  },
  {
    id: "6",
    name: "Recovery Yoga",
    description: "Gentle stretching and mobility work",
    category: "Recovery",
  },
  {
    id: "7",
    name: "Sprint Training",
    description: "Speed and acceleration work",
    category: "Speed",
  },
  {
    id: "8",
    name: "Plyometric Power",
    description: "Jump training and explosive movements",
    category: "Power",
  },
];

// Exercise type definition
type Exercise = {
  id: string;
  name: string;
  description: string;
  category: string;
};

function WorkoutModal({
  visible,
  onClose,
  onCreateWorkout,
  isCreating,
}: {
  visible: boolean;
  onClose: () => void;
  onCreateWorkout: (name: string, date: string, exercises: Exercise[]) => void;
  isCreating: boolean;
}) {
  const [showWorkoutForm, setShowWorkoutForm] = useState(false);
  const [workoutName, setWorkoutName] = useState("");
  const [workoutDate, setWorkoutDate] = useState(new Date());
  const [tempDate, setTempDate] = useState(new Date());
  const [showDateModal, setShowDateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<Exercise[]>([]);
  const colorScheme = useColorScheme();

  const filteredTemplates = TEMPLATE_WORKOUTS.filter(
    (template) =>
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.category.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // sets workout name and shows workout form
  const handleSelectTemplate = (template: (typeof TEMPLATE_WORKOUTS)[0]) => {
    setWorkoutName(template.name);
    setShowWorkoutForm(true);
  };

  // clears workout name and shows workout form
  const handleCreateNewWorkout = () => {
    setWorkoutName("");
    setShowWorkoutForm(true);
  };

  // creates workout and closes modal
  const handleCreateWorkout = () => {
    if (!workoutName.trim()) return;
    onCreateWorkout(workoutName, workoutDate.toISOString(), selectedExercises);
    setWorkoutName("");
    setWorkoutDate(new Date());
    setSelectedExercises([]);
    setShowWorkoutForm(false);
  };

  // closes modal and clears workout name
  const handleCancel = () => {
    setWorkoutName("");
    setWorkoutDate(new Date());
    setSelectedExercises([]);
    setShowWorkoutForm(false);
    onClose();
  };

  // adds exercise to selected exercises
  const handleExerciseSelect = (exercise: Exercise) => {
    setSelectedExercises([...selectedExercises, exercise]);
  };

  // removes exercise from selected exercises
  const handleExerciseRemove = (exerciseId: string) => {
    setSelectedExercises(
      selectedExercises.filter((ex) => ex.id !== exerciseId),
    );
  };

  const renderTemplateItem = ({
    item,
  }: {
    item: (typeof TEMPLATE_WORKOUTS)[0];
  }) => (
    <TouchableOpacity
      onPress={() => handleSelectTemplate(item)}
      className="bg-white dark:bg-zinc-800 rounded-lg p-4 mb-3 border border-gray-200 dark:border-zinc-700"
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-lg font-semibold dark:text-white mb-1">
            {item.name}
          </Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            {item.description}
          </Text>
          <View className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded-full self-start">
            <Text className="text-blue-800 dark:text-blue-200 text-xs font-medium">
              {item.category}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
        <View className="flex-row justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
          <TouchableOpacity onPress={handleCancel}>
            <Text className="text-blue-500 text-lg font-medium">Cancel</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold dark:text-white">
            {showWorkoutForm ? "New Workout" : "Choose Workout Template"}
          </Text>
          <View className="w-16" />
        </View>

        {!showWorkoutForm ? (
          <>
            <View className="px-6 pt-4">
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search templates..."
                className="bg-gray-100 dark:bg-zinc-800 rounded-lg p-3 text-foreground dark:text-white mb-4"
                placeholderTextColor="#9ca3af"
              />
            </View>

            <Text className="px-6 text-lg font-medium text-gray-700 dark:text-gray-300 mb-3">
              Choose from templates
            </Text>
            {/* Template Workouts */}
            <ScrollView className="flex-1 px-6">
              <FlatList
                data={filteredTemplates}
                renderItem={renderTemplateItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ListEmptyComponent={
                  <View className="flex-1 items-center justify-center py-8">
                    <Text className="text-gray-500 dark:text-gray-400">
                      No templates found
                    </Text>
                  </View>
                }
              />
            </ScrollView>

            <View className="p-6">
              <TouchableOpacity
                onPress={handleCreateNewWorkout}
                className="border-2 border-green-500 dark:border-green-700 rounded-lg p-4 items-center bg-transparent"
              >
                <Text className="text-green-500 dark:text-green-700 font-medium text-lg">
                  Create New Workout
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View className="flex-1 px-6 pt-6">
            <View className="mb-4">
              <Text className="text-sm text-gray-600 dark:text-gray-300 mb-1">
                Workout Name
              </Text>
              <TextInput
                value={workoutName}
                onChangeText={setWorkoutName}
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
                  setTempDate(workoutDate);
                  setShowDateModal(true);
                }}
                className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Text className="dark:text-white">
                  {workoutDate.toLocaleDateString()}
                </Text>
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
                          setWorkoutDate(tempDate);
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
            {/* Exercise Selector */}
            <ExerciseSelector
              selectedExercises={selectedExercises}
              onExerciseSelect={handleExerciseSelect}
              onExerciseRemove={handleExerciseRemove}
            />
            <View className="p-2 py-6">
              <TouchableOpacity
                onPress={handleCreateWorkout}
                className="border-2 border-green-500 dark:border-green-700 rounded-lg p-4 items-center bg-green-50 dark:bg-green-700"
                disabled={isCreating}
              >
                <Text className="text-white font-medium text-lg">
                  Create New Workout
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export default function ProgramPage() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { user } = useAuth();
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);

  const queryClient = useQueryClient();

  // mutation handling for workout creation
  const createWorkoutMutation = useMutation({
    mutationFn: (body: {
      name: string;
      date: string;
      athlete_id: string;
      coach_id: string;
    }) => createWorkout(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts", athleteId] });
      setShowWorkoutModal(false);
    },
    onMutate: async (newWorkout) => {
      await queryClient.cancelQueries({ queryKey: ["workouts", athleteId] });
      const previous = queryClient.getQueryData(["workouts", athleteId]);

      queryClient.setQueryData(
        ["workouts", athleteId],
        (old: { id: string; name: string; date: string }[]) => [
          ...old,
          { ...newWorkout, id: "temp-" + Date.now() },
        ],
      );

      return { previous };
    },
    onError: (error, newWorkout, context) => {
      queryClient.setQueryData(["workouts", athleteId], context?.previous);
      console.error("Failed to create workout:", error);
    },
  });

  // fetching athlete profile
  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => fetchAthleteProfile(athleteId),
  });

  const handleCreateWorkout = (
    name: string,
    date: string,
    exercises: Exercise[],
  ) => {
    if (!name.trim() || !user?.id) return;

    const body = {
      name,
      date,
      athlete_id: athleteId,
      coach_id: user.id,
      exercises,
    };

    createWorkoutMutation.mutate(body);
  };

  const handleModalClose = () => {
    setShowWorkoutModal(false);
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
            <TouchableOpacity
              onPress={() => setShowWorkoutModal(true)}
              className="bg-green-500 dark:bg-green-700 rounded-xl p-4 items-center"
            >
              <Text className="text-white font-medium">Add New Workout</Text>
            </TouchableOpacity>
          </View>
        )}

        <WorkoutModal
          visible={showWorkoutModal}
          onClose={handleModalClose}
          onCreateWorkout={handleCreateWorkout}
          isCreating={createWorkoutMutation.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
