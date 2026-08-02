import { Text as RNText, type TextProps as RNTextProps } from "react-native";

/**
 * Typography primitive. Every string in the app goes through here so the type
 * scale stays in one place.
 *
 * On React Native a weight utility does not select a face — the exact loaded
 * family has to be named — so each variant pins its own `font-*` family class.
 * Using Tailwind's `font-semibold` here would silently do nothing.
 */
export type TextVariant =
  | "display"
  | "title"
  | "heading"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption"
  | "overline";

export type TextTone =
  | "ink"
  | "body"
  | "muted"
  | "primary"
  | "onPrimary"
  /** On a high-contrast ink fill — selected chips. */
  | "onInk"
  | "error";

const VARIANT: Record<TextVariant, string> = {
  // Fraunces carries titles and numerals; a total set in a serif reads
  // monumental in a way Inter can't manage.
  display: "text-display font-fraunces-bold",
  title: "text-title font-fraunces",
  heading: "text-heading font-inter-semibold",
  body: "text-body font-inter",
  bodyStrong: "text-body font-inter-medium",
  label: "text-label font-inter-medium",
  caption: "text-caption font-inter",
  overline: "text-overline font-inter-semibold uppercase",
};

const TONE: Record<TextTone, string> = {
  ink: "text-ink dark:text-ink-dark",
  body: "text-body-text dark:text-body-text-dark",
  muted: "text-muted dark:text-muted-dark",
  primary: "text-primary dark:text-primary-dark",
  onPrimary: "text-on-primary dark:text-on-primary-dark",
  onInk: "text-canvas dark:text-canvas-dark",
  error: "text-error",
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
}

export function Text({
  variant = "body",
  tone = "body",
  className = "",
  ...rest
}: TextProps) {
  return (
    <RNText
      className={`${VARIANT[variant]} ${TONE[tone]} ${className}`}
      {...rest}
    />
  );
}
