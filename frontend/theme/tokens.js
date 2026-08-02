/**
 * Single source of truth for LiftOff's design tokens.
 *
 * Consumed two ways:
 *   - tailwind.config.js  (CommonJS require) -> utility classes
 *   - runtime TS          (import)           -> navigation theme,
 *                                              placeholderTextColor, icon colors
 *
 * Direction: Uber's structural discipline wearing Claude's warm surfaces.
 * Coral owns every primary action so "coral means the action" stays learnable.
 * Calibrated plate colors are reserved for weight data and nothing else.
 *
 * Add a color here, never inline a hex in a component.
 */

/**
 * Light theme. Surfaces and text follow Claude's published palette.
 *
 * Coral is deliberately NOT Claude's #CC785C for anything text-bearing:
 * white on #CC785C is only 3.30:1 and coral-on-canvas only 3.11:1, both of
 * which fail WCAG AA for normal text. #A9583E (Claude's own `primary-active`)
 * reaches 5.06:1 under white labels and 4.77:1 as link text on canvas.
 * #CC785C is kept as `primaryAccent` for uses that only need 3:1 — hairline
 * borders, focus rings, and large marks.
 */
const light = {
  canvas: "#FAF9F5",
  surface: "#F5F0E8",
  surfaceStrong: "#EFE9DE",
  hairline: "#E6DFD8",
  ink: "#141413",
  bodyText: "#3D3D3A",
  muted: "#6C6A64",
  primary: "#A9583E",
  primaryPressed: "#8F4A34",
  primaryAccent: "#CC785C",
  primaryDisabled: "#E6DFD8",
  onPrimary: "#FFFFFF",
  onDisabled: "#8E8B82",
};

/**
 * Dark theme: warm, never blue-black.
 *
 * The coral inverts. Against #181715 the lighter #CC785C is the accessible
 * one (5.49:1), and a coral fill takes ink-colored labels rather than white —
 * white on #CC785C would still be 3.30:1.
 */
const dark = {
  canvas: "#181715",
  surface: "#1F1E1B",
  surfaceStrong: "#252320",
  // Lighter than a straight inversion would suggest: at #2E2C28 an unselected
  // chip's outline was nearly invisible against the canvas, since a border on
  // canvas has far less to work with than a divider inside a raised surface.
  hairline: "#38352F",
  ink: "#FAF9F5",
  bodyText: "#D6D3CC",
  muted: "#A09D96",
  primary: "#CC785C",
  primaryPressed: "#A9583E",
  primaryAccent: "#E09B80",
  primaryDisabled: "#3A342F",
  onPrimary: "#181715",
  onDisabled: "#6C6A64",
};

/**
 * Calibrated plate colors — the sport's own color language, which lifters
 * already read at a glance to see what's loaded.
 *
 * RESERVED FOR WEIGHT DATA. Use as small marks only: a leading bar, a dot, a
 * badge. Never as a large fill and never as a button background — `plate25`
 * sits close to the coral primary in hue, and the two must not be confusable.
 * Most of these have nowhere to appear until workout logging ships; the only
 * current use is the weight-class row.
 */
const plate = {
  25: "#C0392B",
  20: "#2B5FA8",
  15: "#D9A521",
  10: "#2E8B57",
  5: "#F2F0EA",
  2.5: "#1C1B19",
};

const semantic = {
  success: "#5DB872",
  warning: "#D4A017",
  error: "#C64545",
};

/**
 * Font families. On React Native a weight class does not select a face — you
 * must name the exact loaded family — so these are family utilities
 * (`font-inter-semibold`), not Tailwind's weight utilities (`font-semibold`).
 * Every name here must match a key passed to useFonts in app/_layout.tsx.
 */
const fontFamily = {
  inter: ["Inter_400Regular"],
  "inter-medium": ["Inter_500Medium"],
  "inter-semibold": ["Inter_600SemiBold"],
  fraunces: ["Fraunces_600SemiBold"],
  "fraunces-bold": ["Fraunces_700Bold"],
};

/** Type scale. Fraunces for titles and numerals, Inter for everything else. */
const fontSize = {
  display: ["40px", { lineHeight: "42px", letterSpacing: "-1px" }],
  title: ["30px", { lineHeight: "33px", letterSpacing: "-0.5px" }],
  heading: ["20px", { lineHeight: "26px" }],
  body: ["16px", { lineHeight: "24px" }],
  label: ["14px", { lineHeight: "20px" }],
  caption: ["13px", { lineHeight: "18px" }],
  overline: ["12px", { lineHeight: "17px", letterSpacing: "1.5px" }],
};

/**
 * Radii. Uber's pill inputs and Claude's 8px conflict; the resolution is 8px
 * for inputs and buttons (cream + pill reads consumer-fintech), 12px cards,
 * 24px sheet corners, and pill only for chips — which keeps a chip visually
 * distinct from an input.
 */
const borderRadius = {
  control: "8px",
  card: "12px",
  sheet: "24px",
  pill: "9999px",
};

module.exports = { light, dark, plate, semantic, fontFamily, fontSize, borderRadius };
