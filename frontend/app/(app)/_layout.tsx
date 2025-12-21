import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

export default function AppLayout() {
  const { isAuthenticated, isProfileComplete } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isProfileComplete}>
        <Stack.Screen name="create-profile" />
      </Stack.Protected>
    </Stack>
  );
}
