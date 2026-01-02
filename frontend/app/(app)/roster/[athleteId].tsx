import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { AthleteProfileView } from "@/types/types";

/* Display of athlete profile from roster tab*/
export default function AthleteDetails() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const router = useRouter();

  // fetching athlete profile
  const {
    data: athleteData,
    isLoading,
    error,
  } = useQuery<AthleteProfileView>({
    queryKey: ["athlete", athleteId],
    queryFn: () =>
      fetchAthleteProfile(athleteId) as unknown as Promise<AthleteProfileView>,
    enabled: !!athleteId,
  });

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950 p-4">
        <Text className="text-foreground dark:text-white text-lg mb-4">
          Athlete not found
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-violet-500 dark:bg-violet-700 px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-medium">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const fullName = `${athleteData?.first_name} ${athleteData?.last_name}`;

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <ScrollView className="flex-1">
        <View className="items-center mt-8 mb-6 px-6">
          <View className="relative">
            <Image
              source={
                athleteData?.avatar_url
                  ? { uri: athleteData.avatar_url }
                  : require("@/assets/images/avatar-default.png")
              }
              className="w-32 h-32 rounded-full border-4 border-white dark:border-zinc-800"
              placeholder={require("@/assets/images/avatar-default.png")}
              contentFit="cover"
            />
          </View>

          <Text className="text-2xl font-bold mt-4 text-foreground dark:text-white text-center">
            {fullName}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            @{athleteData?.username}
          </Text>

          {(athleteData?.federation_code ||
            athleteData?.division_name ||
            athleteData?.weight_class_name) && (
            <View className="flex-row flex-wrap justify-center mt-4 gap-2">
              {athleteData?.federation_code && (
                <View className="bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded-full">
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {athleteData?.federation_code}
                  </Text>
                </View>
              )}
              {athleteData?.division_name && (
                <View className="bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded-full">
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {athleteData?.division_name}
                  </Text>
                </View>
              )}
              {athleteData?.weight_class_name && (
                <View className="bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded-full">
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {athleteData?.weight_class_name}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View className="px-6">
          <TouchableOpacity
            onPress={() => router.push(`/program/${athleteData?.athlete_id}`)}
            className="bg-violet-500 dark:bg-violet-700 rounded-xl p-4 items-center"
          >
            <Text className="text-white font-medium">Manage Program</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
