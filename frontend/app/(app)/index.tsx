import { Text, View } from "react-native";

import { useAuth } from "@/contexts/OldAuthContext";

export default function Index() {
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
      <Text
        onPress={async () => {
          // The `app/(app)/_layout.tsx` will redirect to the sign-in screen.
          await handleLogout();
        }}
        style={{ fontSize: 18, color: "red" }}
      >
        Sign Out
      </Text>
    </View>
  );
}
