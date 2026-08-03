import { type LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";
import { Text } from "./Text";

/**
 * An empty screen is an invitation to act, not a status report.
 *
 * So `title` names what isn't there yet and `body` says what happens next —
 * never an apology, and never just "No data".
 */
export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <View className="mb-1 h-14 w-14 items-center justify-center rounded-card bg-surface dark:bg-surface-dark">
        <Icon size={24} color={colors.muted} strokeWidth={1.75} />
      </View>

      <Text variant="heading" tone="ink" className="text-center">
        {title}
      </Text>

      <Text variant="body" tone="muted" className="text-center">
        {body}
      </Text>

      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          onPress={onAction}
          className="mt-2"
        />
      ) : null}
    </View>
  );
}
