import { View } from "react-native";
import { describeApiError } from "@/lib/api/client";
import { Button } from "./Button";
import { Text } from "./Text";

export interface QueryErrorProps {
  /** Whatever TanStack Query handed back. Passed through `describeApiError`, so
   * a raw `TypeError` becomes "Could not reach the server" rather than
   * "Network request failed". */
  error: unknown;
  /** Usually the query's own `refetch`. */
  onRetry: () => void;
  /** Shown when the error carries no message of its own. Write it as what the
   * user was trying to do — "Could not load your roster." */
  fallback?: string;
}

/**
 * A failed read, said out loud.
 *
 * ⚠️ **This exists because the alternative is the app lying.** TanStack Query
 * returns `data: undefined` on failure, and every screen here branches on exactly
 * that — so without an error branch a backend that is down renders the *empty
 * state*. Home told an athlete "Nothing scheduled" when their coach had assigned
 * four; the roster showed a coach with seventeen athletes an empty list.
 *
 * That is worse than a visible error: the app states something false, and the
 * user's reasonable conclusion is that their coach did nothing. It is also the
 * failure most likely on a phone in a gym, which is where this app is used.
 *
 * Deliberately a body component rather than a whole-screen replacement, so a
 * screen keeps its header and chrome while the content area explains itself.
 */
export function QueryError({ error, onRetry, fallback }: QueryErrorProps) {
  return (
    <View className="min-h-72 flex-1 items-center justify-center gap-4 px-6 py-16">
      <Text variant="body" tone="muted" className="text-center">
        {describeApiError(error, fallback ?? "Something went wrong.")}
      </Text>
      <Button label="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}
