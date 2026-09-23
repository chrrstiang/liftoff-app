import "@/global.css";

import Provider from "@/components/Provider";
import { Button, Text } from "@/components/ui";
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
  const { isAuthenticated, isProfileComplete, isLoading, profileError, reloadProfile } =
    useAuth();
  const segments = useSegments();
  const router = useRouter();

  /** ⚠️ Authenticated, but we do not yet know whether their profile is complete.
   *
   * `null` is falsy, so every `!isProfileComplete` below would treat "unknown" as
   * "incomplete" and route a returning user to the signup form — which is the bug
   * this whole three-state shape exists to prevent. The check has to be explicit,
   * and it has to come before any routing decision. */
  const profileUnknown = isAuthenticated && isProfileComplete === null;

  const isReady = useMemo(() => {
    if (isLoading) return false;
    // Hold rather than guess. The user stays where they are until we can answer.
    if (isAuthenticated && isProfileComplete === null) return false;

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
    // Never route on an unknown profile. Holding is always recoverable; routing
    // to create-profile is not — POST /users/profile inserts rather than upserts,
    // so a user with an existing row cannot complete the form they were sent to.
    if (profileUnknown) return;

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
    profileUnknown,
    segments,
    router,
  ]);

  // An unknown profile with a known cause is worth saying out loud. Without this
  // the user sits on an indefinite spinner, which is the other way of being
  // unhelpful about the same failure.
  if (profileUnknown && profileError) {
    return <ProfileUnavailableScreen message={profileError} onRetry={reloadProfile} />;
  }

  if (!isReady) {
    return <AuthLoadingScreen />;
  }

  return <Slot />;
}

/** Shown when the session restored but the profile could not be loaded.
 *
 * Deliberately **not** a redirect. The failure here is "we could not ask the
 * API", and the honest response is to say so and offer to try again — not to
 * guess at the answer and route somewhere on the guess.
 */
function ProfileUnavailableScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-canvas px-8 dark:bg-canvas-dark">
      <Text variant="title" tone="ink" className="text-center">
        Can’t reach LiftOff
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        {message}
      </Text>
      <Button label="Try again" variant="secondary" onPress={() => void onRetry()} />
    </View>
  );
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
