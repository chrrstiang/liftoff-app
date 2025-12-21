import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

export default function AppLayout() {
  const { isAuthenticated, isProfileComplete } = useAuth();

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isProfileComplete}>
        <Stack.Screen name="create-profile" />
      </Stack.Protected>
    </Stack>
  );
}
