import { AuthProvider } from "@/contexts/AuthContext";
import { navigationDarkTheme, navigationLightTheme } from "@/theme/navigation";
import { ThemeProvider } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useColorScheme } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

const queryClient = new QueryClient();

export default function Provider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();

  return (
    // SafeAreaProvider must sit outermost: components/ui/Screen renders a
    // SafeAreaView, which reads insets from this context and silently gets
    // zero without it.
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Token-derived themes rather than the stock DefaultTheme/DarkTheme,
              which is what made the tab bar and links render system blue. */}
          <ThemeProvider
            value={
              colorScheme === "dark"
                ? navigationDarkTheme
                : navigationLightTheme
            }
          >
            <KeyboardProvider>{children}</KeyboardProvider>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
