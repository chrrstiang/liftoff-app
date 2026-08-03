import {
  DarkTheme,
  DefaultTheme,
  type Theme,
} from "@react-navigation/native";

import { dark, light } from "./tokens";

/**
 * React Navigation themes built from our tokens.
 *
 * Without these the app passes stock DefaultTheme/DarkTheme, which is why the
 * tab bar's active tint was iOS system blue instead of the brand color and its
 * surfaces were pure #fff/#000 rather than the warm canvas. Navigation chrome
 * has to be themed here — it never sees a Tailwind class.
 */
export const navigationLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: light.primary,
    background: light.canvas,
    card: light.canvas,
    text: light.ink,
    border: light.hairline,
    notification: light.primary,
  },
};

export const navigationDarkTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: dark.primary,
    background: dark.canvas,
    card: dark.canvas,
    text: dark.ink,
    border: dark.hairline,
    notification: dark.primary,
  },
};
