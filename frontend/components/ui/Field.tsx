import { View } from "react-native";

import { Text } from "./Text";

/**
 * Label + control + hint/error wrapper.
 *
 * Replaces the label-above-input markup that was copy-pasted ten times, in two
 * mutually incompatible sizes, with no error or hint slot anywhere.
 */
export interface FieldProps {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  /** Renders a subtle marker next to the label. */
  optional?: boolean;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  optional = false,
  className = "",
}: FieldProps) {
  return (
    <View className={`gap-1.5 ${className}`}>
      <View className="flex-row items-baseline gap-2">
        <Text variant="label" tone="ink">
          {label}
        </Text>
        {optional ? (
          <Text variant="caption" tone="muted">
            Optional
          </Text>
        ) : null}
      </View>

      {children}

      {/* Error wins over hint — showing both competes for the same glance. */}
      {error ? (
        <Text variant="caption" tone="error">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
