import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
  StyleSheet,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRoster, sendInvite } from "@/lib/api/roster";
import { Image as ExpoImage } from "expo-image";
import { FontAwesome } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useMemo, useEffect } from "react";
import { AthleteProfileView, UserProfileEnriched } from "@/types/types";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { searchAthletes } from "@/lib/api/athlete";

type AthleteCardProps = {
  athlete: AthleteProfileView | UserProfileEnriched;
  mode?: "roster" | "invite";
  onInvite?: (athleteId: string) => void;
  isInviting?: boolean;
};

function AthleteCard({
  athlete,
  mode = "roster",
  onInvite,
  isInviting,
}: AthleteCardProps) {
  const fullName = `${athlete.first_name} ${athlete.last_name}`;
  const queryClient = useQueryClient();

  // prefetch athlete profile on press for instant loading
  const prefetchAthleteProfile = (
    athleteId: string,
    athleteData: AthleteProfileView
  ) => {
    queryClient.setQueryData(["athlete", athleteId], athleteData);
  };

  const handlePress = () => {
    if (mode === "roster" && "coach_id" in athlete) {
      prefetchAthleteProfile(athlete.athlete_id, athlete);
      router.push(`/roster/${athlete.athlete_id}`);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={mode === "invite"}
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

            {mode === "roster" ? (
              <FontAwesome name="chevron-right" size={14} color="#9ca3af" />
            ) : (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  onInvite?.(athlete.athlete_id);
                }}
                className={`bg-violet-600 px-4 py-2 rounded-lg ${isInviting ? "opacity-50" : ""}`}
                disabled={isInviting}
              >
                <Text className="text-white font-semibold text-sm">
                  {isInviting ? "Inviting..." : "Invite"}
                </Text>
              </TouchableOpacity>
            )}
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  // TODO: Add query for searching all users when in invite mode
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["userSearch", debouncedQuery],
    queryFn: () => searchAthletes(debouncedQuery, userId!),
    enabled: selectedIndex === 1 && debouncedQuery.length >= 3 && !!userId,
    staleTime: 30000,
  });

  const queryClient = useQueryClient();

  const sendInviteMutation = useMutation({
    mutationFn: (athleteId: string) => sendInvite(athleteId, userId!),
    onMutate: async (athleteId: string) => {
      setInvitingUserId(athleteId);
      await queryClient.cancelQueries({ queryKey: ["roster", userId] });

      queryClient.setQueryData<UserProfileEnriched[]>(
        ["userSearch", debouncedQuery, userId],
        (old) => old?.filter((u) => u.athlete_id !== athleteId) || []
      );
    },
    onSuccess: async () => {
      setInvitingUserId(null);
      await queryClient.invalidateQueries({ queryKey: ["roster", userId] });
      Alert.alert("Success", "Invitation sent!");
    },
    onError: () => {
      setInvitingUserId(null);
      Alert.alert("Error", "Failed to send invitation. Please try again.");
    },
  });

  // filtering athletes based on search query and mode
  const filteredData = useMemo(() => {
    if (selectedIndex === 0) {
      if (!searchQuery) return athletes;

      const query = searchQuery.toLowerCase();
      return athletes.filter(
        (athlete) =>
          athlete.first_name.toLowerCase().includes(query) ||
          athlete.last_name.toLowerCase().includes(query) ||
          athlete.username.toLowerCase().includes(query)
      );
    } else {
      return searchQuery ? searchResults : [];
    }
  }, [athletes, searchResults, searchQuery, selectedIndex]);

  const handleSegmentChange = (event: {
    nativeEvent: { selectedSegmentIndex: number };
  }) => {
    setSelectedIndex(event.nativeEvent.selectedSegmentIndex);
    setSearchQuery("");
  };

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
        <SegmentedControl
          values={["My Athletes", "Invite Athletes"]}
          selectedIndex={selectedIndex}
          onChange={handleSegmentChange}
          style={styles.segmentedControl}
        />
        <View className="bg-white dark:bg-zinc-900 rounded-lg flex-row items-center px-3 py-2">
          <FontAwesome name="search" size={16} color="#9ca3af" />
          <TextInput
            className="flex-1 ml-2 text-foreground dark:text-white"
            placeholder={
              selectedIndex === 0
                ? "Search athletes..."
                : "Search users to invite..."
            }
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
        data={filteredData}
        keyExtractor={(item) =>
          selectedIndex === 0 ? item.athlete_id : item.username
        }
        renderItem={({ item }) => (
          <AthleteCard
            athlete={item}
            mode={selectedIndex === 0 ? "roster" : "invite"}
            onInvite={(athleteId) => {
              sendInviteMutation.mutate(athleteId);
            }}
            isInviting={invitingUserId === item.athlete_id}
          />
        )}
        className="py-4"
        refreshControl={
          selectedIndex === 0 ? (
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              colors={["#7c3aed"]}
              tintColor="#7c3aed"
            />
          ) : undefined
        }
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center p-8">
            <Text className="text-gray-500 dark:text-gray-400 text-center">
              {selectedIndex === 0
                ? "No athletes found in your roster"
                : searchQuery
                  ? isSearching
                    ? "Searching..."
                    : "No users found"
                  : "Start typing to search users"}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  segmentedControl: {
    marginBottom: 10,
  },
});
