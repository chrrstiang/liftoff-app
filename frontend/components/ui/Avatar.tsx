import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

/**
 * Circular avatar with the shared default fallback.
 *
 * This exists partly to own the `expo-image` sizing in one place: `Image` is
 * not a NativeWind component, so `className` on it only worked because
 * `cssInterop` happened to be called as a side effect in profile.tsx — any
 * screen rendering an avatar without importing that file got an unstyled
 * image. Sizing here is a StyleSheet because it is passed as `style`.
 */
export interface AvatarProps {
  uri?: string | null;
  size?: number;
  className?: string;
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
});

export function Avatar({ uri, size = 56, className = "" }: AvatarProps) {
  return (
    <View
      className={`overflow-hidden rounded-pill bg-surface dark:bg-surface-dark ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        source={uri ? { uri } : require("@/assets/images/avatar-default.png")}
        placeholder={require("@/assets/images/avatar-default.png")}
        style={styles.fill}
        contentFit="cover"
        transition={200}
        key={uri}
      />
    </View>
  );
}
