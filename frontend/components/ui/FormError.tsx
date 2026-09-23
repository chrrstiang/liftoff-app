import { View } from "react-native";
import { Text } from "./Text";

export interface FormErrorProps {
  /** Already a sentence. Callers run their error through `describeAuthError` or
   * `describeApiError` first, because only they know what the user was doing. */
  message: string;
  /** Usually a link out to the fix — "Go to sign in" when the address is
   * already registered. */
  children?: React.ReactNode;
}

/**
 * A submit that failed, said out loud and left on screen.
 *
 * An `Alert` was what the auth screens used, and it is the wrong control for
 * this: it is dismissed before the user can act on it, it cannot hold a link,
 * and it covers the form they need to correct. The message belongs under the
 * fields, next to what caused it.
 *
 * Per-field problems go in `Input`'s own `error` prop. This is for the ones the
 * server only discovers on submit.
 */
export function FormError({ message, children }: FormErrorProps) {
  return (
    <View className="mt-5 rounded-card border-l-2 border-error bg-surface p-4 dark:bg-surface-dark">
      <Text variant="body" tone="ink">
        {message}
      </Text>
      {children}
    </View>
  );
}
