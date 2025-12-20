import "@/global.css";

import { Stack } from "expo-router";
import Provider from "@/components/Provider";

export default function RootLayout() {
  return (
    <Provider>
      <Stack initialRouteName="(app)" screenOptions={{ headerShown: false }} />
    </Provider>
  );
}
