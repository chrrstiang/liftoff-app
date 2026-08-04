import { Avatar, Button, EmptyState, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { searchAthletes } from "@/lib/api/athlete";
import { fetchRoster, sendInvite } from "@/lib/api/roster";
import { useTheme } from "@/theme/useTheme";
import { AthleteProfileView, UserProfileEnriched } from "@/types";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, Search, Users, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

/** SegmentedControl is a native view and FlatList's contentContainerStyle
 * takes a style object — neither accepts a className. */
const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  segmentLabel: { fontFamily: "Inter_500Medium" },
  segmentLabelActive: { fontFamily: "Inter_600SemiBold" },
});

type AthleteCardProps = {
  athlete: AthleteProfileView | UserProfileEnriched;
  mode?: "roster" | "invite";
  onInvite?: (athleteId: string) => void;
  isInviting?: boolean;
};

/** One athlete as a ruled row rather than a floating card — the meet-sheet
 * treatment, so a long roster reads as a list instead of a stack of tiles. */
function AthleteCard({
  athlete,
  mode = "roster",
  onInvite,
  isInviting,
}: AthleteCardProps) {
  const fullName = `${athlete.first_name} ${athlete.last_name}`;
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  // prefetch athlete profile on press for instant loading
  const prefetchAthleteProfile = (
    athleteId: string,
    athleteData: AthleteProfileView,
  ) => {
    queryClient.setQueryData(["athlete", athleteId], athleteData);
  };

  const handlePress = () => {
    if (mode === "roster" && "coach_id" in athlete) {
      prefetchAthleteProfile(athlete.athlete_id, athlete);
      router.push(`/roster/${athlete.athlete_id}`);
    }
  };

  const meta = [
    athlete.federation_code,
    athlete.weight_class_name,
    athlete.division_name,
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      disabled={mode === "invite"}
      className="flex-row items-center gap-4 px-6 py-4 active:bg-surface dark:active:bg-surface-dark"
    >
      <Avatar uri={athlete.avatar_url} />

      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" tone="ink" numberOfLines={1}>
          {fullName}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          @{athlete.username}
        </Text>
        {meta.length > 0 ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta.join(" · ")}
          </Text>
        ) : null}
      </View>

      {mode === "roster" ? (
        <ChevronRight size={18} strokeWidth={2} color={colors.muted} />
      ) : (
        <Button
          label={isInviting ? "Inviting" : "Invite"}
          variant="secondary"
          loading={isInviting}
          disabled={isInviting}
          onPress={() => onInvite?.(athlete.athlete_id)}
        />
      )}
    </Pressable>
  );
}

export default function RosterPage() {
  const { user } = useAuth();
  const { colors, scheme } = useTheme();
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
        (old) => old?.filter((u) => u.athlete_id !== athleteId) || [],
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
          athlete.username.toLowerCase().includes(query),
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
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <View className="gap-3 px-6 pb-3 pt-2">
        {/* Native view, so it takes real colour values rather than classes. */}
        <SegmentedControl
          values={["My Athletes", "Invite Athletes"]}
          selectedIndex={selectedIndex}
          onChange={handleSegmentChange}
          appearance={scheme}
          tintColor={colors.surfaceStrong}
          backgroundColor={colors.surface}
          fontStyle={{ ...styles.segmentLabel, color: colors.muted }}
          activeFontStyle={{ ...styles.segmentLabelActive, color: colors.ink }}
        />

        <View className="flex-row items-center gap-2 rounded-control bg-surface px-3 dark:bg-surface-dark">
          <Search size={16} strokeWidth={2} color={colors.muted} />
          <TextInput
            className="h-11 flex-1 font-inter text-body text-ink dark:text-ink-dark"
            placeholder={
              selectedIndex === 0
                ? "Search athletes..."
                : "Search users to invite..."
            }
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              onPress={() => setSearchQuery("")}
            >
              <X size={16} strokeWidth={2} color={colors.muted} />
            </Pressable>
          ) : null}
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
        ItemSeparatorComponent={() => (
          <View className="ml-24 h-px bg-hairline dark:bg-hairline-dark" />
        )}
        contentContainerStyle={
          filteredData.length === 0 ? styles.grow : undefined
        }
        refreshControl={
          selectedIndex === 0 ? (
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          ) : undefined
        }
        ListEmptyComponent={
          <View className="flex-1 py-16">
            <EmptyState
              icon={Users}
              title={
                selectedIndex === 0
                  ? "No athletes yet"
                  : searchQuery
                    ? isSearching
                      ? "Searching"
                      : "No one found"
                    : "Find an athlete"
              }
              body={
                selectedIndex === 0
                  ? "Invite an athlete from the Invite tab and they'll appear here once they accept."
                  : searchQuery
                    ? isSearching
                      ? "Looking for matching athletes."
                      : "No athlete matches that search. Try a different name or username."
                    : "Type at least three characters to search by name or username."
              }
            />
          </View>
        }
      />
    </Screen>
  );
}
