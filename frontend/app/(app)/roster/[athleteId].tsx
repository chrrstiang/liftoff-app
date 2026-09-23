import {
  Avatar,
  Button,
  EmptyState,
  QueryError,
  Screen,
  Section,
  SheetRow,
  Text,
} from "@/components/ui";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { createConversation } from "@/lib/api/conversations";
import { ApiError, describeApiError } from "@/lib/api/client";
import { useTheme } from "@/theme/useTheme";
import { AthleteProfileView } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserX } from "lucide-react-native";
import { ActivityIndicator, Alert, View } from "react-native";

/* Display of athlete profile from roster tab*/
export default function AthleteDetails() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  /** Opens the thread with this athlete, creating it if it does not exist.
   *
   * ⚠️ **This is the flow that had no entry point at all.** `POST /conversations`
   * did not exist in any form, and nothing in the app wrote a `conversations` or
   * `conversation_members` row — so the Messages tab was permanently empty for
   * every user and there was no way to start a first conversation. A coach could
   * see their roster and program for them but never message them.
   *
   * The endpoint is idempotent, so this is safe to tap repeatedly: an existing
   * thread is returned rather than a duplicate created. No optimistic update —
   * navigating to a conversation id that does not exist yet would 404 the thread
   * screen, and there is nothing to show until the server has assigned the id.
   */
  const openConversation = useMutation({
    mutationFn: () => createConversation(athleteId),
    onSuccess: ({ conversation_id }) => {
      // The inbox now has a thread it did not have before.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/conversations/${conversation_id}`);
    },
    onError: (error) => {
      Alert.alert("Error", describeApiError(error, "Could not open the conversation."));
    },
  });

  // fetching athlete profile
  const {
    data: athleteData,
    isLoading,
    error,
    refetch,
  } = useQuery<AthleteProfileView>({
    queryKey: ["athlete", athleteId],
    queryFn: () =>
      fetchAthleteProfile(athleteId) as unknown as Promise<AthleteProfileView>,
    enabled: !!athleteId,
  });

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  /* ⚠️ A 404 and a dropped connection are different answers and must not share a
     screen. This previously showed "Athlete not found — may have been removed
     from your roster" for *any* error, so a moment of bad wifi told a coach their
     athlete was gone. Only a real 404 means that. */
  if (error instanceof ApiError && error.statusCode === 404) {
    return (
      <Screen>
        <View className="flex-1 py-16">
          <EmptyState
            icon={UserX}
            title="Athlete not found"
            body="This profile could not be loaded. It may have been removed from your roster."
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <QueryError
          error={error}
          onRetry={() => void refetch()}
          fallback="Could not load this athlete."
        />
      </Screen>
    );
  }

  const fullName = `${athleteData?.first_name} ${athleteData?.last_name}`;

  return (
    <Screen scroll>
      <View className="items-center px-6 pt-8">
        <Avatar uri={athleteData?.avatar_url} size={112} />

        <Text variant="title" tone="ink" className="mt-5 text-center">
          {fullName}
        </Text>
        <Text variant="body" tone="muted" className="mt-1">
          @{athleteData?.username}
        </Text>
      </View>

      {/* Competing details as ruled rows rather than a row of grey pills —
          they are facts with labels, not tags. */}
      {athleteData?.federation_code ||
      athleteData?.division_name ||
      athleteData?.weight_class_name ? (
        <Section label="Competing" className="mt-10 px-6">
          {athleteData?.federation_code ? (
            <SheetRow label="Federation" value={athleteData.federation_code} />
          ) : null}
          {athleteData?.division_name ? (
            <SheetRow label="Division" value={athleteData.division_name} />
          ) : null}
          {athleteData?.weight_class_name ? (
            <SheetRow
              label="Weight class"
              value={athleteData.weight_class_name}
              numeric
            />
          ) : null}
        </Section>
      ) : null}

      {/* Only one `primary` Button per screen, so Message is secondary. */}
      <View className="gap-3 px-6 pb-10 pt-10">
        <Button
          label="Manage program"
          block
          onPress={() => router.push(`/program/${athleteData?.athlete_id}`)}
        />
        <Button
          label="Maxes"
          variant="secondary"
          block
          onPress={() => router.push(`/maxes/${athleteData?.athlete_id}`)}
        />
        <Button
          label={openConversation.isPending ? "Opening" : "Message"}
          variant="secondary"
          block
          loading={openConversation.isPending}
          disabled={openConversation.isPending || !athleteData?.athlete_id}
          onPress={() => openConversation.mutate()}
        />
      </View>
    </Screen>
  );
}
