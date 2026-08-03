import { Text as RNText, type TextProps } from "react-native";

/**
 * A number, set in Fraunces with tabular figures.
 *
 * Weights, totals and dates are the app's real content, so they get the serif
 * and they get fixed-width digits — without `tabular-nums` the glyphs are
 * proportional and a column of loads visibly jitters as values change.
 *
 * `fontVariant` has no Tailwind utility, which is the one reason this reaches
 * for a style prop instead of a class.
 */
export type NumeralSize = "display" | "title" | "body" | "label";

const SIZE: Record<NumeralSize, string> = {
  display: "text-display font-fraunces-bold",
  title: "text-title font-fraunces",
  body: "text-body font-fraunces",
  label: "text-label font-fraunces",
};

export interface NumeralProps extends TextProps {
  size?: NumeralSize;
  className?: string;
}

export function Numeral({
  size = "body",
  className = "",
  style,
  ...rest
}: NumeralProps) {
  return (
    <RNText
      className={`${SIZE[size]} text-ink dark:text-ink-dark ${className}`}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
      {...rest}
    />
  );
}
