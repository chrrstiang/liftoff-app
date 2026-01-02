import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRoster } from "@/lib/api/roster";
import { Image as ExpoImage } from "expo-image";
import { FontAwesome } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useMemo } from "react";
import { AthleteProfileView } from "@/types/types";

function AthleteCard({ athlete }: { athlete: AthleteProfileView }) {
  const fullName = `${athlete.first_name} ${athlete.last_name}`;

  const queryClient = useQueryClient();

  // prefetch athlete profile on press for instant loading
  const prefetchAthleteProfile = (
    athleteId: string,
    athleteData: AthleteProfileView
  ) => {
    queryClient.setQueryData(["athlete", athleteId], athleteData);
  };

  return (
    <TouchableOpacity
      onPress={() => {
        prefetchAthleteProfile(athlete.athlete_id, athlete);
        router.push(`/roster/${athlete.athlete_id}`);
      }}
      className="bg-white dark:bg-zinc-900 p-4 rounded-lg mb-3 mx-4 shadow-sm"
    >
      <View className="flex-row items-center">
        <View className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-100 dark:border-zinc-800">
          <ExpoImage
            source={
              athlete.avatar_url
                ? { uri: athlete.avatar_url }
                : require("@/assets/images/avatar-default.png")
            }
            className="w-full h-full"
            contentFit="cover"
            transition={200}
          />
        </View>

        <View className="ml-4 flex-1">
          <View className="flex-row justify-between items-center">
            <Text
              className="text-lg font-semibold text-foreground dark:text-white"
              numberOfLines={1}
            >
              {fullName}
            </Text>
            <FontAwesome name="chevron-right" size={14} color="#9ca3af" />
          </View>

          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            @{athlete.username}
          </Text>

          <View className="flex-row flex-wrap mt-1">
            {athlete.federation_code && (
              <View className="bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded-md mr-2 mb-2">
                <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {athlete.federation_code}
                </Text>
              </View>
            )}

            {athlete.weight_class_name && (
              <View className="bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded-md mr-2 mb-2">
                <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {athlete.weight_class_name}
                </Text>
              </View>
            )}

            {athlete.division_name && (
              <View className="bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded-md mr-2 mb-2">
                <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {athlete.division_name}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function RosterPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [searchQuery, setSearchQuery] = useState("");

  // fetching roster
  const {
    data: athletes = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<AthleteProfileView[]>({
    queryKey: ["roster", userId],
    queryFn: () =>
      fetchRoster(userId!) as unknown as Promise<AthleteProfileView[]>,
    enabled: !!userId,
  });

  // filtering athletes based on search query
  const filteredAthletes = useMemo(() => {
    if (!searchQuery) return athletes;

    const query = searchQuery.toLowerCase();
    return athletes.filter(
      (athlete) =>
        athlete.first_name.toLowerCase().includes(query) ||
        athlete.last_name.toLowerCase().includes(query) ||
        athlete.username.toLowerCase().includes(query)
    );
  }, [athletes, searchQuery]);

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <View className="px-4 py-3 bg-background dark:bg-zinc-950">
        <View className="bg-white dark:bg-zinc-900 rounded-lg flex-row items-center px-3 py-2">
          <FontAwesome name="search" size={16} color="#9ca3af" />
          <TextInput
            className="flex-1 ml-2 text-foreground dark:text-white"
            placeholder="Search athletes..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <FontAwesome name="times-circle" size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <FlatList
        data={filteredAthletes}
        keyExtractor={(item) => item.athlete_id}
        renderItem={({ item }) => <AthleteCard athlete={item} />}
        className="py-4"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={["#7c3aed"]}
            tintColor="#7c3aed"
          />
        }
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center p-8">
            <Text className="text-gray-500 dark:text-gray-400 text-center">
              No athletes found in your roster
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
