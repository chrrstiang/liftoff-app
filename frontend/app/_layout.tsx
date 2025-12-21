import "@/global.css";

import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import Provider from "@/components/Provider";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityIndicator } from "react-native";

export default function RootLayout() {
  return (
    <Provider>
      <RootLayoutNav />
    </Provider>
  );
}

function RootLayoutNav() {
  const { isAuthenticated, isProfileComplete, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    // Redirect based on auth state
    if (!isAuthenticated && !inAuthGroup) {
      console.log("Redirecting to login");
      router.replace("/(auth)/login");
    } else if (isAuthenticated && !isProfileComplete) {
      console.log("Redirecting to create-profile");
      router.replace("/(app)/create-profile");
    } else if (
      isAuthenticated &&
      isProfileComplete &&
      segments.some((seg) => seg === "create-profile")
    ) {
      console.log("Redirecting to home");
      router.replace("/(app)/(tabs)/home");
    }
  }, [isAuthenticated, isProfileComplete, isLoading, segments, router]);

  if (isLoading) {
    return <ActivityIndicator />;
  }

  return <Slot />;
}
