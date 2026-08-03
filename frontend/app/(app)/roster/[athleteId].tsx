import {
  Avatar,
  Button,
  EmptyState,
  Screen,
  Section,
  SheetRow,
  Text,
} from "@/components/ui";
import { fetchAthleteProfile } from "@/lib/api/athlete";
import { useTheme } from "@/theme/useTheme";
import { AthleteProfileView } from "@/types/types";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserX } from "lucide-react-native";
import { ActivityIndicator, View } from "react-native";

/* Display of athlete profile from roster tab*/
export default function AthleteDetails() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const router = useRouter();
  const { colors } = useTheme();

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
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (error) {
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

      <View className="px-6 pb-10 pt-10">
        <Button
          label="Manage program"
          block
          onPress={() => router.push(`/program/${athleteData?.athlete_id}`)}
        />
      </View>
    </Screen>
  );
}
