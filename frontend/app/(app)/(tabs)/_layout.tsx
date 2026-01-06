import { RelativePathString, Tabs } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityIndicator, View } from "react-native";

export default function TabLayout() {
  const { user, isLoading, profile } = useAuth();

  if (isLoading || !user || !profile) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <Tabs>
      <Tabs.Screen
        options={{ headerShown: false, title: "Home" }}
        name="home"
      />
      <Tabs.Screen
        options={{
          headerShown: false,
          title: "Messages",
        }}
        name="conversations/conversations"
      />
      <Tabs.Protected guard={profile.is_athlete}>
        <Tabs.Screen
          options={{
            headerShown: false,
            title: "Program",
            href: `/program/${user.id}` as RelativePathString,
          }}
          name="program/[athleteId]"
        />
      </Tabs.Protected>
      <Tabs.Protected guard={profile.is_coach}>
        <Tabs.Screen
          options={{ headerShown: false, title: "Roster" }}
          name="roster/roster"
        />
      </Tabs.Protected>
      <Tabs.Screen
        options={{ headerShown: false, title: "Profile" }}
        name="profile"
      />
    </Tabs>
  );
}
