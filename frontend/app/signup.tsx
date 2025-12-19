import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

  async function handleSignIn() {
    if (!API_BASE_URL) {
      console.error("API base URL not configured");
      return;
    }

    console.log("Attempting login with API URL:", API_BASE_URL);
    console.log("Login data:", { email, password });

    const loginData = { email, password };
    console.log("Login request body:", JSON.stringify(loginData, null, 2));

    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(loginData),
    });
    console.log("Response status:", response.status);
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );
    const data = await response.json();
    console.log("Login response:", data);
    if (!response.ok) {
      console.error("Login failed:", data);
      console.error("Response text:", await response.text());
      throw new Error("Login failed");
    }
    console.log("Login successful", data);
    // Navigate to home screen on successful login
    router.push("/home");
  }

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-2xl font-bold text-foreground">Login</Text>
      <View className="w-full max-w-sm mt-8">
        {/* Login form would go here */}
        <View className="bg-card p-6 rounded-lg shadow-md">
          <Text className="text-lg font-semibold text-card-foreground mb-4">
            Welcome back
          </Text>
          {/* Form fields would go here */}
          <View className="mt-4">
            <Text className="text-sm text-muted-foreground">Email</Text>
            <TextInput
              className="h-10 bg-input border border-input rounded-md px-3 py-2 mt-1"
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
            <Text className="text-sm text-muted-foreground">Password</Text>
            <TextInput
              className="h-10 bg-input border border-input rounded-md px-3 py-2 mt-1"
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
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
              onPress={handleSignIn}
            >
              <Text className="text-center font-medium">Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
