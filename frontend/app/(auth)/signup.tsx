import { Button, FormError, Input, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  authFailureCode,
  describeAuthError,
  MIN_PASSWORD_LENGTH,
  validateCredentials,
} from "@/lib/auth-errors";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Shown instead of a bare error, so the fix is one tap away. */
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const { signup } = useAuth();

  async function handleSignUp() {
    /* Checked here rather than left to Supabase: a mistyped password is silent
       otherwise, and the account it creates cannot be recovered. */
    const problems = validateCredentials({ email, password, confirmPassword });
    setFieldErrors(problems);
    setFormError(null);
    setAlreadyRegistered(false);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      await signup(email.trim(), password);
      // No manual navigation: the auth gate in app/_layout.tsx routes to
      // create-profile once the session lands.
    } catch (error) {
      console.error("Signup failed:", error);
      setAlreadyRegistered(authFailureCode(error) === "user_already_exists");
      setFormError(
        describeAuthError(error, "Could not create your account. Try again in a moment."),
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
            error={fieldErrors.email}
          />

          <Input
            label="Password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            hint={`Use ${MIN_PASSWORD_LENGTH} or more characters.`}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
          />

          <Input
            label="Confirm password"
            placeholder="Type it again"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={fieldErrors.confirmPassword}
          />
        </View>

        {formError ? (
          <FormError message={formError}>
            {alreadyRegistered ? (
              <Link href="/login" asChild>
                <Pressable accessibilityRole="link" hitSlop={8} className="mt-2">
                  <Text variant="bodyStrong" tone="primary">
                    Go to sign in
                  </Text>
                </Pressable>
              </Link>
            ) : null}
          </FormError>
        ) : null}

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
