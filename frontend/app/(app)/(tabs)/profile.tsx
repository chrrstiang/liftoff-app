import { uploadAvatar, updateUserAvatar } from "@/lib/api/storage";
import { Image } from "expo-image";
import { useAuth } from "@/contexts/AuthContext";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useState } from "react";
import { FontAwesome } from "@expo/vector-icons";
import { cssInterop } from "nativewind";

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
    <View className="flex-1 bg-white p-6">
      <View className="items-center mt-8 mb-6">
        <View className="relative">
          <Image
            source={
              profile?.avatar_url
                ? { uri: profile.avatar_url }
                : require("@/assets/images/avatar-default.png")
            }
            className=" w-32 h-32 rounded-full"
            placeholder={require("@/assets/images/avatar-default.png")}
            contentFit="cover"
            key={profile?.avatar_url}
          />
          <TouchableOpacity
            onPress={handleUploadAvatar}
            disabled={isUploading}
            className="absolute -bottom-2 -right-2 bg-blue-500 p-3 rounded-full"
          >
            {isUploading ? (
              <ActivityIndicator color="white" />
            ) : (
              <FontAwesome name="camera" size={20} color="white" />
            )}
          </TouchableOpacity>
        </View>

        <Text className="text-2xl font-bold mt-4">
          {profile?.first_name} {profile?.last_name}
        </Text>
        <Text className="text-gray-500">{profile?.email || user?.email}</Text>
      </View>

      <View className="mt-8">
        <Text className="text-lg font-semibold mb-2">Account Information</Text>
        <View className="bg-gray-50 p-4 rounded-lg">
          <View className="flex-row justify-between py-2 border-b border-gray-100">
            <Text className="text-gray-600">Email</Text>
            <Text className="font-medium">{profile?.email || user?.email}</Text>
          </View>
          <View className="flex-row justify-between py-2">
            <Text className="text-gray-600">Role</Text>
            <Text className="text-blue-500 font-medium capitalize">user</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
