import { View, Text, TouchableOpacity } from "react-native";

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
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 20 }}>Home</Text>
      <TouchableOpacity
        style={{ padding: 10, backgroundColor: "red", borderRadius: 5 }}
        onPress={() => handleLogout()}
      >
        <Text style={{ color: "white" }}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
