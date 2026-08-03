import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

/**
 * Bottom sheet shell: scrim, rounded top, Cancel / title / Done header.
 *
 * Replaces two near-identical implementations — the generic SelectionModal and
 * a hand-duplicated date modal — whose behavior had diverged. Cancel here
 * always discards.
 */
export interface SheetProps {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onDone: () => void;
  doneLabel?: string;
}

export function Sheet({
  visible,
  title,
  children,
  onCancel,
  onDone,
  doneLabel = "Done",
}: SheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      {/* Tapping the scrim is a cancel, matching the header button. */}
      <Pressable className="flex-1 justify-end bg-ink/40" onPress={onCancel}>
        <Pressable
          // Swallow taps so they don't fall through to the scrim.
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-sheet bg-canvas pb-2 dark:bg-surface-dark"
        >
          <View className="flex-row items-center justify-between px-4 py-4">
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              hitSlop={8}
            >
              <Text variant="body" tone="muted">
                Cancel
              </Text>
            </Pressable>

            <Text variant="heading" tone="ink">
              {title}
            </Text>

            <Pressable accessibilityRole="button" onPress={onDone} hitSlop={8}>
              <Text variant="bodyStrong" tone="primary">
                {doneLabel}
              </Text>
            </Pressable>
          </View>

          <View className="h-px bg-hairline dark:bg-hairline-dark" />

          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export interface SelectSheetProps<T> {
  visible: boolean;
  title: string;
  items: T[];
  selected: T | null;
  keyExtractor: (item: T) => string;
  /** Row content. `subtitle` is optional secondary detail. */
  renderLabel: (item: T) => { title: string; subtitle?: string };
  /** Called with the staged choice when Done is pressed. */
  onCommit: (item: T | null) => void;
  onCancel: () => void;
  emptyMessage?: string;
}

/**
 * Single-select list in a bottom sheet.
 *
 * Selection is STAGED: tapping a row updates local state only, Done commits it,
 * Cancel throws it away. The previous SelectionModal committed on tap and wired
 * both Cancel and Done to the same close handler, so Cancel silently confirmed
 * whatever you had touched.
 */
export function SelectSheet<T>({
  visible,
  title,
  items,
  selected,
  keyExtractor,
  renderLabel,
  onCommit,
  onCancel,
  emptyMessage = "Nothing to choose from yet",
}: SelectSheetProps<T>) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [staged, setStaged] = useState<T | null>(selected);

  // Re-seed from the committed value each time the sheet opens, so a previous
  // cancelled edit doesn't leak into the next one.
  useEffect(() => {
    if (visible) setStaged(selected);
  }, [visible, selected]);

  return (
    <Sheet
      visible={visible}
      title={title}
      onCancel={onCancel}
      onDone={() => onCommit(staged)}
    >
      {/* Proportional to the viewport rather than the old hardcoded 256px cap,
          which truncated long federation lists on every screen size. */}
      <ScrollView style={{ maxHeight: height * 0.5 }}>
        {items.length === 0 ? (
          <View className="px-4 py-8">
            <Text variant="body" tone="muted" className="text-center">
              {emptyMessage}
            </Text>
          </View>
        ) : (
          items.map((item, i) => {
            const { title: rowTitle, subtitle } = renderLabel(item);
            const isStaged =
              staged !== null && keyExtractor(staged) === keyExtractor(item);

            return (
              <View key={keyExtractor(item)}>
                {i > 0 ? (
                  <View className="ml-4 h-px bg-hairline dark:bg-hairline-dark" />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isStaged }}
                  onPress={() => setStaged(item)}
                  className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-surface dark:active:bg-surface-strong-dark"
                >
                  <View className="flex-1">
                    <Text
                      variant={isStaged ? "bodyStrong" : "body"}
                      tone={isStaged ? "ink" : "body"}
                    >
                      {rowTitle}
                    </Text>
                    {subtitle ? (
                      <Text variant="caption" tone="muted">
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>

                  {isStaged ? (
                    <Check size={18} color={colors.primary} strokeWidth={2.5} />
                  ) : null}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </Sheet>
  );
}
