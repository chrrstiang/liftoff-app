import { Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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
export interface MultiSelectSheetProps<T> {
  visible: boolean;
  title: string;
  items: T[];
  /** Keys of the currently committed selection. */
  selected: string[];
  keyExtractor: (item: T) => string;
  renderLabel: (item: T) => { title: string; subtitle?: string };
  /** Called with the staged keys when Done is pressed. */
  onCommit: (keys: string[]) => void;
  onCancel: () => void;
  emptyMessage?: string;
}

/**
 * Multi-select list in a bottom sheet.
 *
 * Same staging contract as `SelectSheet` — tapping toggles local state only,
 * Done commits, Cancel throws it away — so the two behave identically and a
 * reader does not have to check which one they are looking at.
 *
 * Exists for bulk assign, where a coach picks several athletes at once. Keyed on
 * strings rather than items so the caller does not need referential stability
 * across refetches: a roster row re-fetched by TanStack Query is a new object,
 * and an item-identity version would silently drop the selection.
 */
export function MultiSelectSheet<T>({
  visible,
  title,
  items,
  selected,
  keyExtractor,
  renderLabel,
  onCommit,
  onCancel,
  emptyMessage = "Nothing to choose from yet",
}: MultiSelectSheetProps<T>) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [staged, setStaged] = useState<string[]>(selected);

  /** ⚠️ Re-seed only on the **transition** into visible, not on every render
   * while visible.
   *
   * `selected` is an array, and a caller passing a literal (`selected={[]}`,
   * which is the natural thing to write) produces a new reference every render.
   * With `selected` in the dependency list and no transition guard, any unrelated
   * re-render while the sheet is open — a sibling query resolving, a background
   * refetch — re-runs the effect and silently wipes whatever the user has already
   * tapped, with no visual sign anything happened.
   *
   * Guarding here rather than asking every caller to hoist a stable constant:
   * the trap is invisible at the call site, and the next caller would fall into
   * it again. */
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) setStaged(selected);
    wasVisible.current = visible;
  }, [visible, selected]);

  const toggle = (key: string) =>
    setStaged((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  return (
    <Sheet
      visible={visible}
      title={title}
      onCancel={onCancel}
      onDone={() => onCommit(staged)}
      doneLabel={staged.length ? `Select ${staged.length}` : "Select"}
    >
      <ScrollView style={{ maxHeight: height * 0.5 }}>
        {items.length === 0 ? (
          <View className="px-4 py-8">
            <Text variant="body" tone="muted" className="text-center">
              {emptyMessage}
            </Text>
          </View>
        ) : (
          items.map((item, i) => {
            const key = keyExtractor(item);
            const { title: rowTitle, subtitle } = renderLabel(item);
            const isStaged = staged.includes(key);

            return (
              <View key={key}>
                {i > 0 ? (
                  <View className="ml-4 h-px bg-hairline dark:bg-hairline-dark" />
                ) : null}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isStaged }}
                  onPress={() => toggle(key)}
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
