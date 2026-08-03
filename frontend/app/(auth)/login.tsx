import { Button, Input, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();

  async function handleSignIn() {
    setSubmitting(true);
    try {
      await login(email, password);
      // No manual navigation: the auth gate in app/_layout.tsx owns the
      // redirect, and pushing here would race it.
    } catch (error) {
      console.error("Login failed:", error);
      Alert.alert(
        "Login Failed",
        "Please check your credentials and try again.",
        [{ text: "OK", style: "cancel" }],
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll centered dismissKeyboard>
      <View className="w-full max-w-sm self-center px-6 py-10">
        {/* No logo asset exists and there is no SVG dependency, so the
            wordmark is set in type — Fraunces at display size. */}
        <Text variant="display" tone="ink">
          LiftOff
        </Text>
        <Text variant="body" tone="muted" className="mt-2">
          Log your lifts. Share your best.
        </Text>

        <View className="mt-10 gap-5">
          <Input
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <Button
          label="Sign in"
          block
          loading={submitting}
          onPress={handleSignIn}
          className="mt-8"
        />

        <View className="mt-6 flex-row justify-center gap-1">
          <Text variant="body" tone="muted">
            New to LiftOff?
          </Text>
          <Link href="/signup" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text variant="bodyStrong" tone="primary">
                Create an account
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </Screen>
  );
}
