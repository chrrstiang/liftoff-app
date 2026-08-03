/**
 * Single source of truth for LiftOff's design tokens.
 *
 * Consumed two ways:
 *   - tailwind.config.js  (CommonJS require) -> utility classes
 *   - runtime TS          (import)           -> navigation theme,
 *                                              placeholderTextColor, icon colors
 *
 * Direction: Uber's structural discipline wearing warm surfaces.
 * Deep green owns every primary action so "green means the action" stays
 * learnable. Calibrated plate colors are reserved for weight data.
 *
 * The accent is deliberately NOT a terracotta/coral. Warm cream plus coral is
 * the single most common generated aesthetic right now, and the point of the
 * green is that LiftOff doesn't read as someone else's app.
 *
 * Add a color here, never inline a hex in a component.
 */

/**
 * Light theme. Surfaces and text follow a warm cream palette.
 *
 * #104547 is a deep petrol green and enormously legible on cream — 10.15:1 as
 * link text and 10.69:1 under white labels, comfortably past AA and close to
 * AAA. That headroom is why it can carry both fills and text without a
 * separate text-safe variant, which the previous coral needed.
 *
 * `primaryAccent` is a lighter step for uses that only need 3:1 — hairline
 * borders, focus rings, large marks.
 */
const light = {
  canvas: "#FAF9F5",
  surface: "#F5F0E8",
  surfaceStrong: "#EFE9DE",
  hairline: "#E6DFD8",
  ink: "#141413",
  bodyText: "#3D3D3A",
  muted: "#6C6A64",
  primary: "#104547",
  primaryPressed: "#0A3133",
  primaryAccent: "#2C7276",
  primaryDisabled: "#E6DFD8",
  onPrimary: "#FFFFFF",
  onDisabled: "#8E8B82",
};

/**
 * Dark theme: warm, never blue-black.
 *
 * The green has to invert, and by more than the coral did. #104547 is only
 * 1.68:1 against #181715 — a near-invisible button — because a colour that
 * dark has nowhere to go on a dark canvas. #468E91 holds the same 182° hue at
 * a higher lightness and reaches 4.72:1, and its fill takes ink-colored
 * labels rather than white.
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
  primary: "#468E91",
  primaryPressed: "#37767A",
  primaryAccent: "#6FB3B6",
  primaryDisabled: "#3A342F",
  onPrimary: "#181715",
  onDisabled: "#6C6A64",
};

/**
 * Calibrated plate colors — the sport's own color language, which lifters
 * already read at a glance to see what's loaded.
 *
 * RESERVED FOR WEIGHT DATA. Use as small marks only: a leading bar, a dot, a
 * badge. Never as a large fill and never as a button background.
 *
 * ⚠️ Since the primary went green, `plate10` (#2E8B57) is the one to watch —
 * it is 1.12:1 against the dark-mode primary, i.e. effectively the same colour.
 * A green plate mark beside a green action button would be unreadable as two
 * different things. Keep plate marks small and never adjacent to a primary
 * button. The unused `success` (#5DB872) has the same problem and should be
 * re-picked before anything uses it — "green means action" and "green means
 * success" cannot both be true.
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
