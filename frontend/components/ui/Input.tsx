import { useState } from "react";
import { TextInput, type TextInputProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Field } from "./Field";

/**
 * Text input. One height, one radius, one padding — previously the same
 * logical control was `h-10 rounded-md px-3 py-2` on auth and
 * `h-12 rounded-lg px-4` on create-profile.
 *
 * Also sets placeholderTextColor, which nothing did before: the default
 * placeholder is near-invisible against a dark surface.
 */
export interface InputProps extends Omit<TextInputProps, "className"> {
  label?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Taller multi-line box, for things like a coach bio. */
  multilineRows?: number;
  className?: string;
}

export function Input({
  label,
  hint,
  error,
  optional,
  multilineRows,
  className = "",
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const border = error
    ? "border-error"
    : focused
      ? "border-primary-accent dark:border-primary-accent-dark"
      : "border-hairline dark:border-hairline-dark";

  const input = (
    <TextInput
      className={`rounded-control border px-4 text-body font-inter text-ink dark:text-ink-dark bg-canvas dark:bg-surface-dark ${border} ${
        multilineRows ? "py-3" : "h-12"
      } ${className}`}
      style={multilineRows ? { minHeight: multilineRows * 24 + 24 } : undefined}
      placeholderTextColor={colors.muted}
      multiline={Boolean(multilineRows)}
      textAlignVertical={multilineRows ? "top" : "center"}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );

  if (!label) return input;

  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {input}
    </Field>
  );
}
