const {
  light,
  dark,
  plate,
  semantic,
  fontFamily,
  fontSize,
  borderRadius,
} = require("./theme/tokens");

/**
 * Colors are exposed as an explicit light name plus a `-dark` counterpart
 * (`bg-canvas dark:bg-canvas-dark`). The pairing is done ONCE per component in
 * components/ui — screens never write raw color classes. That component layer
 * is what prevents light and dark from drifting apart, which is how the app
 * ended up with `bg-violet-500 dark:bg-red-700` on a single button.
 */
const colors = {
  canvas: light.canvas,
  "canvas-dark": dark.canvas,
  surface: light.surface,
  "surface-dark": dark.surface,
  "surface-strong": light.surfaceStrong,
  "surface-strong-dark": dark.surfaceStrong,
  hairline: light.hairline,
  "hairline-dark": dark.hairline,

  ink: light.ink,
  "ink-dark": dark.ink,
  "body-text": light.bodyText,
  "body-text-dark": dark.bodyText,
  muted: light.muted,
  "muted-dark": dark.muted,

  primary: light.primary,
  "primary-dark": dark.primary,
  "primary-pressed": light.primaryPressed,
  "primary-pressed-dark": dark.primaryPressed,
  "primary-accent": light.primaryAccent,
  "primary-accent-dark": dark.primaryAccent,
  "primary-disabled": light.primaryDisabled,
  "primary-disabled-dark": dark.primaryDisabled,
  "on-primary": light.onPrimary,
  "on-primary-dark": dark.onPrimary,
  "on-disabled": light.onDisabled,
  "on-disabled-dark": dark.onDisabled,

  // Reserved for weight data only — see theme/tokens.js.
  "plate-25": plate[25],
  "plate-20": plate[20],
  "plate-15": plate[15],
  "plate-10": plate[10],
  "plate-5": plate[5],
  "plate-2-5": plate[2.5],

  success: semantic.success,
  warning: semantic.warning,
  error: semantic.error,

  // Aliases for the four names ~24 existing classes were already written
  // against. They resolved to nothing, which is why light mode never rendered.
  // Kept so the pre-redesign screens paint correctly in the interim; the
  // rebuilt screens use the semantic names above.
  background: light.canvas,
  card: light.surface,
  foreground: light.ink,
  "muted-foreground": light.muted,
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./contexts/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
    "./theme/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors,
      fontFamily,
      fontSize,
      // Tailwind's default scale is already the 4px grid Uber's Base uses
      // (1=4, 2=8, 3=12, 4=16, 6=24, 8=32, 12=48), so it is left alone.
      borderRadius,
    },
  },
  plugins: [],
};
