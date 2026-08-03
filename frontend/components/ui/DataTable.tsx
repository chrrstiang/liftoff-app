import { Pressable, StyleSheet, View } from "react-native";

import { Numeral } from "./Numeral";
import { Text } from "./Text";

/**
 * A column-aligned table for set/rep/load data — the app's attempt sheet.
 *
 * The point is that column widths are declared once, here, and shared by the
 * header and every row. The hand-rolled version repeated `w-8 w-16 w-20 w-16
 * w-16` in both places, so a width changed in one and not the other silently
 * knocked the whole grid out of alignment.
 *
 * Cells render through Numeral, which is where tabular figures actually matter:
 * a column of loads set in proportional digits visibly jitters as values change.
 */
export interface DataColumn {
  key: string;
  label: string;
  /** Fixed width in px. Omit on exactly one column to let it take the slack. */
  width?: number;
  align?: "left" | "center" | "right";
}

export interface DataTableRow {
  key: string;
  /** Cell content per column key. Numbers get the serif + tabular treatment. */
  cells: Record<string, string | number | null | undefined>;
  /** Cells that read as entered rather than prescribed. */
  emphasis?: string[];
  onPress?: () => void;
}

export interface DataTableProps {
  columns: DataColumn[];
  rows: DataTableRow[];
  emptyMessage?: string;
}

const ALIGN = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

/** Column widths arrive as numbers from `columns`, so they have to be passed as
 * `style`. The flexible fallback is constant and lives here. */
const styles = StyleSheet.create({
  flexCell: { flex: 1 },
});

export function DataTable({
  columns,
  rows,
  emptyMessage = "Nothing here yet",
}: DataTableProps) {
  return (
    <View>
      {/* Header: an overline band rather than a filled grey bar, so the table
          reads as ruled paper instead of a spreadsheet chrome. */}
      <View className="flex-row items-center border-b border-hairline pb-2 dark:border-hairline-dark">
        {columns.map((col) => (
          <View
            key={col.key}
            style={col.width ? { width: col.width } : styles.flexCell}
          >
            <Text
              variant="overline"
              tone="muted"
              className={ALIGN[col.align ?? "center"]}
            >
              {col.label}
            </Text>
          </View>
        ))}
      </View>

      {rows.length === 0 ? (
        <View className="py-6">
          <Text variant="caption" tone="muted" className="text-center">
            {emptyMessage}
          </Text>
        </View>
      ) : (
        rows.map((row, i) => {
          const body = (
            <View className="flex-row items-center py-3">
              {columns.map((col) => {
                const raw = row.cells[col.key];
                const value =
                  raw === null || raw === undefined || raw === "" ? "–" : raw;
                const isEmphasis = row.emphasis?.includes(col.key);

                return (
                  <View
                    key={col.key}
                    style={col.width ? { width: col.width } : styles.flexCell}
                  >
                    <Numeral
                      size="label"
                      className={`${ALIGN[col.align ?? "center"]} ${
                        isEmphasis
                          ? "text-primary dark:text-primary-dark"
                          : "text-body-text dark:text-body-text-dark"
                      }`}
                    >
                      {value}
                    </Numeral>
                  </View>
                );
              })}
            </View>
          );

          return (
            <View key={row.key}>
              {i > 0 ? (
                <View className="h-px bg-hairline dark:bg-hairline-dark" />
              ) : null}
              {row.onPress ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={row.onPress}
                  className="active:bg-surface dark:active:bg-surface-dark"
                >
                  {body}
                </Pressable>
              ) : (
                body
              )}
            </View>
          );
        })
      )}
    </View>
  );
}
