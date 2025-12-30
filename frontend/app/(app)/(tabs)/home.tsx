import { SafeAreaView } from "react-native-safe-area-context";
import { Text, TouchableOpacity } from "react-native";

import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const { logout } = useAuth();

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
  }

  return (
    <SafeAreaView className="flex-1 justify-center items-center">
      <Text className="text-2xl">Home</Text>
      <TouchableOpacity
        className="p-2.5 bg-red-500 rounded-md"
        onPress={() => handleLogout()}
      >
        <Text className="text-white">Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
