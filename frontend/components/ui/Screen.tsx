import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

/**
 * Screen shell: safe-area insets, keyboard avoidance, and optional scrolling.
 *
 * Every screen goes through this. Previously none of them handled insets at
 * all — with edgeToEdgeEnabled on Android and no SafeAreaView anywhere, content
 * could sit under the notch — and the auth screens hardcoded
 * KeyboardAvoidingView behavior="padding", which is wrong on Android.
 */
export interface ScreenProps {
  children: React.ReactNode;
  /** Wrap the content in a ScrollView. Use for anything taller than a viewport. */
  scroll?: boolean;
  /**
   * With `scroll`, centers content vertically while it's shorter than the
   * viewport and lets it scroll once it isn't. create-profile depends on this:
   * the form is short until a role is picked, then grows past the screen.
   */
  centered?: boolean;
  /** Tap outside an input to dismiss the keyboard. On for form screens. */
  dismissKeyboard?: boolean;
  edges?: readonly Edge[];
  className?: string;
  contentClassName?: string;
}

/**
 * `contentContainerStyle` takes a style object, not a className — the one
 * sanctioned StyleSheet use in this codebase (see frontend/CLAUDE.md).
 */
const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  growCentered: { flexGrow: 1, justifyContent: "center" },
});

export function Screen({
  children,
  scroll = false,
  centered = false,
  dismissKeyboard = false,
  edges = ["top", "bottom", "left", "right"],
  className = "",
  contentClassName = "",
}: ScreenProps) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={centered ? styles.growCentered : styles.grow}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      className={contentClassName}
    >
      {children}
    </ScrollView>
  ) : (
    <View className={`flex-1 ${contentClassName}`}>{children}</View>
  );

  // accessible={false} keeps the dismiss wrapper from being announced as a
  // control to screen readers.
  const withDismiss = dismissKeyboard ? (
    <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      {body}
    </TouchableWithoutFeedback>
  ) : (
    body
  );

  return (
    <SafeAreaView
      edges={edges}
      className={`flex-1 bg-canvas dark:bg-canvas-dark ${className}`}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {withDismiss}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
