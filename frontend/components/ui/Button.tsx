import { ActivityIndicator, Pressable, type PressableProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

/**
 * Uses Pressable rather than TouchableOpacity so NativeWind's `active:`
 * variant actually fires — the engine attaches onPressIn, which Touchable*
 * doesn't surface. (The pre-redesign buttons used `pressed:`, a variant that
 * does not exist in NativeWind, so nothing in the app had press feedback.)
 *
 * Following Uber's rule: at most one `primary` button per screen.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "h-12 flex-row items-center justify-center gap-2 rounded-control px-5";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark",
  secondary:
    "border border-hairline bg-canvas active:bg-surface-strong dark:border-hairline-dark dark:bg-surface-dark dark:active:bg-surface-strong-dark",
  ghost: "bg-transparent active:bg-surface dark:active:bg-surface-dark",
  danger: "bg-transparent active:bg-surface dark:active:bg-surface-dark",
};

const DISABLED = "bg-primary-disabled dark:bg-primary-disabled-dark";

export interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  /** Fills the width of its container. */
  block?: boolean;
  className?: string;
}

export function Button({
  label,
  variant = "primary",
  loading = false,
  block = false,
  disabled = false,
  className = "",
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  // Both block input, but they look different: a loading button is doing the
  // work you asked for and stays coral, while a disabled one is unavailable.
  const isInert = disabled || loading;

  // A disabled button has to LOOK disabled. Previously `disabled` was set on
  // three buttons with no visual change at all.
  const surface =
    disabled && variant === "primary" ? DISABLED : VARIANT[variant];

  const tone = (() => {
    if (disabled) return "muted";
    if (variant === "primary") return "onPrimary";
    if (variant === "danger") return "error";
    return "ink";
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      disabled={isInert}
      className={`${BASE} ${surface} ${block ? "w-full" : ""} ${
        disabled && variant !== "primary" ? "opacity-50" : ""
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.onPrimary : colors.primary}
        />
      ) : null}
      <Text variant="label" tone={tone}>
        {label}
      </Text>
    </Pressable>
  );
}
