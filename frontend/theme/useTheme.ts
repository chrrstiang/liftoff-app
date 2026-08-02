import { useColorScheme } from "react-native";

import { dark, light } from "./tokens";

export type ThemeColors = typeof light;
export type ThemeScheme = "light" | "dark";

/**
 * Resolved token set for the active color scheme.
 *
 * For anything that takes a real color value rather than a class:
 * `placeholderTextColor`, lucide icon `color`, `ActivityIndicator`, and the
 * navigation theme. Styling that CAN be a class should be a class.
 */
export function useTheme(): { colors: ThemeColors; scheme: ThemeScheme } {
  const scheme: ThemeScheme = useColorScheme() === "dark" ? "dark" : "light";

  return { colors: scheme === "dark" ? dark : light, scheme };
}
