import { Button, Input, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signup } = useAuth();

  async function handleSignUp() {
    setSubmitting(true);
    try {
      await signup(email, password);
      // No manual navigation: the auth gate in app/_layout.tsx routes to
      // create-profile once the session lands.
    } catch (error) {
      console.error("Signup failed:", error);
      Alert.alert(
        "Signup Failed",
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
        <Text variant="display" tone="ink">
          Get started
        </Text>
        <Text variant="body" tone="muted" className="mt-2">
          Set up your account, then tell us how you lift.
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
            placeholder="At least 8 characters"
            hint="Use 8 or more characters."
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <Button
          label="Create account"
          block
          loading={submitting}
          onPress={handleSignUp}
          className="mt-8"
        />

        <View className="mt-6 flex-row justify-center gap-1">
          <Text variant="body" tone="muted">
            Already have an account?
          </Text>
          <Link href="/login" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text variant="bodyStrong" tone="primary">
                Sign in
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </Screen>
  );
}
