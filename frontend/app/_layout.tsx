import "@/global.css";

import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect, useMemo } from "react";
import Provider from "@/components/Provider";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityIndicator, View } from "react-native";

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

  const isReady = useMemo(() => {
    if (isLoading) return false;

    const inAuthGroup = segments[0] === "(auth)";
    const inCreateProfile = (segments as string[]).includes("create-profile");
    const inApp = segments[0] === "(app)";

    if (!segments[0]) {
      return false;
    }

    // Ready when we're in the RIGHT place
    if (!isAuthenticated && inAuthGroup) {
      return true;
    }
    if (isAuthenticated && !isProfileComplete && inCreateProfile) {
      return true;
    }
    if (isAuthenticated && isProfileComplete && inApp) {
      return true;
    }

    return false;
  }, [isAuthenticated, isProfileComplete, isLoading, segments]);

  useEffect(() => {
    if (isLoading || isReady) return;

    if (!segments[0]) {
      if (!isAuthenticated) {
        router.replace("/(auth)/login");
      } else if (!isProfileComplete) {
        router.replace("/(app)/create-profile");
      } else {
        router.replace("/(app)/(tabs)/home");
      }
      return;
    }

    const inAuthGroup = segments[0] === "(auth)";
    const inCreateProfile = (segments as string[]).includes("create-profile");

    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (isAuthenticated && !isProfileComplete && !inCreateProfile) {
      router.replace("/(app)/create-profile");
    } else if (
      isAuthenticated &&
      isProfileComplete &&
      (inAuthGroup || inCreateProfile)
    ) {
      router.replace("/(app)/(tabs)/home");
    }
  }, [
    isAuthenticated,
    isProfileComplete,
    isLoading,
    isReady,
    segments,
    router,
  ]);

  if (!isReady) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return <Slot />;
}
