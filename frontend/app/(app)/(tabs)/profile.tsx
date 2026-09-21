import { Avatar, Button, Screen, Section, SheetRow, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserAvatar, uploadAvatar } from "@/lib/api/storage";
import { useTheme } from "@/theme/useTheme";
import { router } from "expo-router";
import { Camera } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

const STORAGE_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;

/** Athlete / Coach / both, from the two booleans the profile actually carries. */
function roleLabel(isAthlete?: boolean, isCoach?: boolean) {
  if (isAthlete && isCoach) return "Athlete & Coach";
  if (isCoach) return "Coach";
  if (isAthlete) return "Athlete";
  return "—";
}

export default function ProfilePage() {
  const { user, profile, setProfile, logout } = useAuth();
  const { colors } = useTheme();
  const [isUploading, setIsUploading] = useState(false);

  const handleUploadAvatar = async () => {
    if (isUploading) return;

    setIsUploading(true);
    try {
      if (!profile) {
        console.error("No profile found");
        return;
      }
      if (!user) {
        console.error("No user found");
        return;
      }
      const avatarUrl = await uploadAvatar(user.id);

      if (avatarUrl) {
        // The id is gone: the API scopes the update to the token holder. The
        // previous call took one and wrote that row, so it could set any user's
        // avatar to any path.
        await updateUserAvatar(avatarUrl);
        setProfile({ ...profile, avatar_url: avatarUrl });
      }
    } catch (error) {
      console.error("Failed to upload avatar:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Screen scroll>
      <View className="items-center px-6 pt-8">
        <View className="relative">
          <Avatar
            uri={
              profile?.avatar_url
                ? STORAGE_BASE_URL + profile.avatar_url
                : null
            }
            size={112}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={handleUploadAvatar}
            disabled={isUploading}
            className="absolute -bottom-1 -right-1 h-10 w-10 items-center justify-center rounded-pill bg-primary active:bg-primary-pressed dark:bg-primary-dark"
          >
            {isUploading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Camera size={18} strokeWidth={2} color={colors.onPrimary} />
            )}
          </Pressable>
        </View>

        <Text variant="title" tone="ink" className="mt-5 text-center">
          {profile?.first_name} {profile?.last_name}
        </Text>
        {profile?.username ? (
          <Text variant="body" tone="muted" className="mt-1">
            @{profile.username}
          </Text>
        ) : null}

        {/* Everything below this button used to be the whole screen: read-only
            rows over an endpoint that had always accepted writes. */}
        <Button
          label="Edit profile"
          variant="secondary"
          onPress={() => router.push("/(app)/edit-profile")}
          className="mt-6"
        />
      </View>

      <Section label="Account" className="mt-10 px-6">
        <SheetRow label="Email" value={profile?.email || user?.email} />
        <SheetRow
          label="Role"
          value={roleLabel(profile?.is_athlete, profile?.is_coach)}
        />
        {profile?.gender ? (
          <SheetRow label="Gender" value={profile.gender} />
        ) : null}
      </Section>

      <View className="px-6 pb-10 pt-10">
        <Button
          label="Sign out"
          variant="secondary"
          block
          onPress={async () => {
            await logout();
          }}
        />
      </View>
    </Screen>
  );
}
