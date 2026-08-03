import { Children, type ReactNode } from "react";
import { View } from "react-native";

import { Text } from "./Text";

/**
 * A ruled group of rows — the meet sheet.
 *
 * Powerlifting's own paper artifact is the lifter sheet: an overline heading
 * over hairline-ruled rows, each with a name on the left and a load
 * right-aligned. That's the structure here, rather than floating cards, and
 * it's where the app's visual identity lives.
 *
 * Dividers are interleaved explicitly because NativeWind has no child
 * selectors, so `:last-child` styling isn't available.
 */
export interface SectionProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

export function Section({ label, children, className = "" }: SectionProps) {
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View className={`gap-2 ${className}`}>
      {label ? (
        <Text variant="overline" tone="muted" className="px-1">
          {label}
        </Text>
      ) : null}

      <View className="overflow-hidden rounded-card bg-surface dark:bg-surface-dark">
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? (
              <View className="ml-4 h-px bg-hairline dark:bg-hairline-dark" />
            ) : null}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}
