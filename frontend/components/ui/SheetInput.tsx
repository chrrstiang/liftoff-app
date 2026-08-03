import { useState } from "react";
import { TextInput, type TextInputProps, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

/**
 * A meet-sheet row you type into: label left, value right-aligned.
 *
 * Sits inside a Section alongside SheetRow so a form reads as one ruled sheet
 * rather than a stack of boxed inputs. Use the standalone Input instead when
 * the value is long (a bio) or needs its own error text.
 */
export interface SheetInputProps extends Omit<TextInputProps, "className"> {
  label: string;
  /** Render the value in Fraunces with tabular figures. */
  numeric?: boolean;
}

export function SheetInput({
  label,
  numeric = false,
  onFocus,
  onBlur,
  ...rest
}: SheetInputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-2">
      <Text variant="body" tone="body" className="shrink-0">
        {label}
      </Text>

      <TextInput
        className={`flex-1 py-2 text-right text-body text-ink dark:text-ink-dark ${
          numeric ? "font-fraunces" : "font-inter"
        }`}
        style={numeric ? { fontVariant: ["tabular-nums"] } : undefined}
        placeholderTextColor={focused ? colors.hairline : colors.muted}
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
    </View>
  );
}
