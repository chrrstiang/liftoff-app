import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen options={{ headerShown: false }} name="home" />
      <Tabs.Screen options={{ headerShown: false }} name="program" />
      <Tabs.Screen options={{ headerShown: false }} name="profile" />
    </Tabs>
  );
}
