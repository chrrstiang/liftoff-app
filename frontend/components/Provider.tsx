import { AuthProvider } from "@/contexts/OldAuthContext";
import { ThemeProvider } from "@react-navigation/native";
import { DefaultTheme, DarkTheme } from "@react-navigation/native";
import { useColorScheme } from "react-native";

export default function Provider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
