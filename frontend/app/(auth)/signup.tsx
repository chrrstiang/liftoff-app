import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const { signup } = useAuth();

  async function handleSignUp() {
    try {
      await signup(email, password);
      router.push("/(app)");
    } catch (error) {
      console.error("Signup failed:", error);
      Alert.alert(
        "Signup Failed",
        "Please check your credentials and try again.",
        [{ text: "OK", style: "cancel" }]
      );
    }
  }

  return (
    <KeyboardAvoidingView className="flex-1" behavior="padding">
      <TouchableWithoutFeedback className="p-4" onPress={Keyboard.dismiss}>
        <View className="flex-1 items-center justify-center bg-background dark:bg-zinc-950">
          <Text className="text-2xl font-bold text-foreground dark:text-white">
            Create Account
          </Text>
          <View className="w-full max-w-sm mt-8">
            {/* Login form would go here */}
            <View className="bg-card p-6 rounded-lg shadow-md">
              {/* Form fields would go here */}
              <View className="mt-4">
                <Text className="text-sm text-muted-foreground dark:text-gray-300">
                  Email
                </Text>
                <TextInput
                  className="h-10 border border-gray-300 rounded-md px-3 py-2 mt-1 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                  placeholder="Enter your email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
              <View className="mt-4">
                <Text className="text-sm text-muted-foreground dark:text-gray-300">
                  Password
                </Text>
                <TextInput
                  className="h-10 border border-gray-300 rounded-md px-3 py-2 mt-1 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                  placeholder="Enter your password"
                  secureTextEntry={true}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  value={password}
                  onChangeText={setPassword}
                />
              </View>
              <View className="mt-6">
                <TouchableOpacity
                  className="bg-violet-500 px-4 py-2 rounded-md pressed:bg-violet-600 dark:bg-violet-900 dark:pressed:bg-violet-700"
                  onPress={handleSignUp}
                >
                  <Text className="text-center font-medium text-white">
                    Sign Up
                  </Text>
                </TouchableOpacity>
              </View>
              <View className="mt-4 text-center flex flex-row justify-center">
                <Text className="text-md text-muted-foreground dark:text-gray-300">
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="text-violet-500 dark:text-violet-500 underline"
                  >
                    Sign in here
                  </Link>
                </Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
