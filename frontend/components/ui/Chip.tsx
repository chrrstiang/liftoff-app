import { Pressable, View } from "react-native";

import { Text } from "./Text";

/**
 * Pill toggle. One component for what were two duplicated implementations at
 * two different heights (gender at h-12, role at h-14).
 *
 * Selection is monochrome high-contrast (an ink fill) rather than green. Green
 * is reserved for actions, so if a selected chip were also green the screen
 * would offer two competing "this is the important thing" signals. Uber's
 * maximum-contrast selection and the green action stay legible as two
 * separate languages.
 *
 * Pill radius here is deliberate — it keeps a chip from reading as an input,
 * which uses the 8px control radius.
 */
export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  sublabel?: string;
  size?: "md" | "lg";
  className?: string;
}

export function Chip({
  label,
  selected,
  onPress,
  sublabel,
  size = "md",
  className = "",
}: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`items-center justify-center rounded-pill border px-4 ${
        size === "lg" ? "min-h-14 py-2" : "h-12"
      } ${
        selected
          ? "border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark"
          : "border-hairline bg-transparent active:bg-surface-strong dark:border-hairline-dark dark:active:bg-surface-strong-dark"
      } ${className}`}
    >
      <Text
        variant="label"
        tone={selected ? "onInk" : "body"}
        numberOfLines={1}
      >
        {label}
      </Text>

      {sublabel ? (
        <View>
          <Text
            variant="caption"
            tone={selected ? "onInk" : "muted"}
            numberOfLines={1}
          >
            {sublabel}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
