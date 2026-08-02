import { uploadAvatar, updateUserAvatar } from "@/lib/api/storage";
import { Image } from "expo-image";
import { useAuth } from "@/contexts/AuthContext";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { useState } from "react";
import { FontAwesome } from "@expo/vector-icons";
import { cssInterop } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";

const STORAGE_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;

cssInterop(Image, { className: "style" });

export default function ProfilePage() {
  const { user, profile, setProfile } = useAuth();
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
        await updateUserAvatar(user.id, avatarUrl);
        setProfile({ ...profile, avatar_url: avatarUrl });
      }
    } catch (error) {
      console.error("Failed to upload avatar:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950 p-6">
      <StatusBar barStyle="default" backgroundColor="transparent" />
      <View className="items-center mt-8 mb-6">
        <View className="relative">
          <Image
            source={
              profile?.avatar_url
                ? { uri: STORAGE_BASE_URL + profile.avatar_url }
                : require("@/assets/images/avatar-default.png")
            }
            className="w-32 h-32 rounded-full border-4 border-white dark:border-zinc-800"
            placeholder={require("@/assets/images/avatar-default.png")}
            contentFit="cover"
            key={profile?.avatar_url}
          />
          <TouchableOpacity
            onPress={handleUploadAvatar}
            disabled={isUploading}
            className="absolute -bottom-2 -right-2 bg-violet-500 dark:bg-violet-700 p-3 rounded-full"
          >
            {isUploading ? (
              <ActivityIndicator color="white" />
            ) : (
              <FontAwesome name="camera" size={20} color="white" />
            )}
          </TouchableOpacity>
        </View>

        <Text className="text-2xl font-bold mt-4 text-foreground dark:text-white">
          {profile?.first_name} {profile?.last_name}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400">
          {profile?.email || user?.email}
        </Text>
      </View>

      <View className="mt-8">
        <Text className="text-lg font-semibold mb-2 text-foreground dark:text-white">
          Account Information
        </Text>
        <View className="bg-white dark:bg-zinc-900 p-4 rounded-lg shadow-sm">
          <View className="flex-row justify-between py-3 border-b border-gray-100 dark:border-zinc-800">
            <Text className="text-gray-600 dark:text-gray-300">Email</Text>
            <Text className="font-medium text-foreground dark:text-white">
              {profile?.email || user?.email}
            </Text>
          </View>
          <View className="flex-row justify-between py-3">
            <Text className="text-gray-600 dark:text-gray-300">Role</Text>
            <Text className="text-violet-500 dark:text-violet-400 font-medium capitalize">
              user
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
