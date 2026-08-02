import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Numeral } from "./Numeral";
import { Text } from "./Text";

/**
 * One row of a meet sheet: label left, value right, optional chevron.
 *
 * Numeric values render through Numeral (serif + tabular figures) so a column
 * of loads lines up and doesn't jitter between values.
 */

/**
 * Calibrated plate denominations. Present so weight data can be marked with the
 * sport's own color language once workout logging exists.
 *
 * Deliberately unused today: the app currently has no true weight data — a
 * weight *class* is not a plate *denomination*, and coloring it by one would be
 * decoration pretending to be information. See theme/tokens.js.
 */
export type PlateWeight = 25 | 20 | 15 | 10 | 5 | 2.5;

const PLATE_CLASS: Record<PlateWeight, string> = {
  25: "bg-plate-25",
  20: "bg-plate-20",
  15: "bg-plate-15",
  10: "bg-plate-10",
  5: "bg-plate-5",
  2.5: "bg-plate-2-5",
};

export interface SheetRowProps {
  label: string;
  /** Rendered right-aligned. Falsy falls back to `placeholder` in muted tone. */
  value?: string | number | null;
  placeholder?: string;
  /** Render the value as a Numeral (serif, tabular figures). */
  numeric?: boolean;
  /** Leading color mark on the value, keyed to a plate denomination. */
  mark?: PlateWeight;
  onPress?: () => void;
  /** Shows a chevron. Defaults to true when onPress is given. */
  chevron?: boolean;
  /** Replaces the value entirely — for a switch, checkmark, etc. */
  right?: React.ReactNode;
  disabled?: boolean;
}

export function SheetRow({
  label,
  value,
  placeholder = "Select",
  numeric = false,
  mark,
  onPress,
  chevron,
  right,
  disabled = false,
}: SheetRowProps) {
  const { colors } = useTheme();
  const showChevron = chevron ?? Boolean(onPress);
  const hasValue = value !== null && value !== undefined && value !== "";

  const body = (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
      <Text variant="body" tone="body" className="flex-1">
        {label}
      </Text>

      {right ?? (
        <View className="flex-row items-center gap-2">
          {mark ? (
            <View className={`h-4 w-[3px] rounded-pill ${PLATE_CLASS[mark]}`} />
          ) : null}

          {hasValue ? (
            numeric ? (
              <Numeral size="body">{value}</Numeral>
            ) : (
              <Text variant="bodyStrong" tone="ink">
                {value}
              </Text>
            )
          ) : (
            <Text variant="body" tone="muted">
              {placeholder}
            </Text>
          )}
        </View>
      )}

      {showChevron ? (
        <ChevronRight size={18} color={colors.muted} strokeWidth={2} />
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${hasValue ? `, ${String(value)}` : ""}`}
      disabled={disabled}
      onPress={onPress}
      className={`active:bg-surface-strong dark:active:bg-surface-strong-dark ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {body}
    </Pressable>
  );
}
