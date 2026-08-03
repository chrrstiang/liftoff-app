import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/theme/useTheme";
import { RelativePathString, Tabs } from "expo-router";
import {
  ClipboardList,
  House,
  MessageCircle,
  User,
  Users,
} from "lucide-react-native";
import { ActivityIndicator, View } from "react-native";

export default function TabLayout() {
  const { user, isLoading, profile } = useAuth();
  const { colors } = useTheme();

  if (isLoading || !user || !profile) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas dark:bg-canvas-dark">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Tabs
      // Set on the navigator rather than per screen, so a new tab can't
      // silently arrive with a header the rest of the app doesn't have.
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.canvas,
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="conversations/conversations"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Protected guard={profile.is_athlete}>
        <Tabs.Screen
          name="program/[athleteId]"
          options={{
            title: "Program",
            href: `/program/${user.id}` as RelativePathString,
            tabBarIcon: ({ color, size }) => (
              <ClipboardList color={color} size={size} strokeWidth={2} />
            ),
          }}
        />
      </Tabs.Protected>
      <Tabs.Protected guard={profile.is_coach}>
        <Tabs.Screen
          name="roster/roster"
          options={{
            title: "Roster",
            tabBarIcon: ({ color, size }) => (
              <Users color={color} size={size} strokeWidth={2} />
            ),
          }}
        />
      </Tabs.Protected>
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <User color={color} size={size} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}
