import "@/global.css";

import Provider from "@/components/Provider";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/theme/useTheme";
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from "@expo-google-fonts/fraunces";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Slot, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";

// Hold the native splash until the fonts are ready, otherwise the first frame
// renders in the system face and visibly reflows once Inter/Fraunces land.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  useEffect(() => {
    // Hide on error too: falling back to system faces beats an app that never
    // gets past the splash screen because a font failed to decode.
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <Provider>
      <StatusBar style="auto" />
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
    return <AuthLoadingScreen />;
  }

  return <Slot />;
}

/** Shown while the stored Supabase session is being restored, and while the
 * auth gate settles on a destination. */
function AuthLoadingScreen() {
  const { colors } = useTheme();

  return (
    <View className="flex-1 items-center justify-center bg-canvas dark:bg-canvas-dark">
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
