import { Redirect, RelativePathString, Tabs } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityIndicator } from "react-native";

export default function TabLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <ActivityIndicator />;
  }

  if (!user) {
    console.error("No user found. Redirecting to login...");
    return <Redirect href="/login" />;
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
          title: "Program",
          href: `/program/${user.id}` as RelativePathString,
        }}
        name="program/[athleteId]"
      />
      <Tabs.Screen
        options={{ headerShown: false, title: "Profile" }}
        name="profile"
      />
    </Tabs>
  );
}
