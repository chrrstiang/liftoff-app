import { Avatar, Text } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Message } from "@/types/types";
import { format } from "date-fns";
import { Image } from "expo-image";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

const AVATAR_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;

/** expo-image takes a style object, not a className. */
const styles = StyleSheet.create({
  media: { width: 192, height: 192, borderRadius: 12 },
});

export function MessageBubble({
  message,
  isMe,
}: {
  message: Message;
  isMe: boolean;
}) {
  const imageSource = useMemo(() => {
    if (message.message_type !== "image") return null;

    if (!message.media_url) {
      return null;
    }

    if (
      message.media_url.startsWith("file") ||
      message.media_url.startsWith("content")
    ) {
      return { uri: message.media_url };
    }

    const { data } = supabase.storage
      .from("conversations")
      .getPublicUrl(message.media_url);

    return { uri: data.publicUrl };
  }, [message.media_url, message.message_type]);

  const isOptimistic = message.id.length < 30;

  return (
    <View className={`mb-3 ${isMe ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[85%] flex-row ${isMe ? "justify-end" : "justify-start"}`}
      >
        {!isMe ? (
          <View className="mr-2 self-end">
            <Avatar
              uri={
                message.sender_avatar_url
                  ? AVATAR_BASE_URL + message.sender_avatar_url
                  : null
              }
              size={32}
            />
          </View>
        ) : null}

        <View
          className={`rounded-card ${
            isMe
              ? "rounded-br-none bg-primary dark:bg-primary-dark"
              : "rounded-bl-none bg-surface dark:bg-surface-dark"
          }`}
        >
          {message.message_type === "image" ? (
            <View className="p-1">
              <Image
                key={message.id}
                source={imageSource}
                style={styles.media}
                contentFit="cover"
                transition={200}
                priority={isOptimistic ? "high" : "normal"}
              />
              {isOptimistic ? (
                <View className="absolute inset-0 items-center justify-center rounded-card bg-ink/20">
                  <ActivityIndicator color="white" size="small" />
                </View>
              ) : null}
            </View>
          ) : (
            <View className="px-4 py-2.5">
              <Text variant="body" tone={isMe ? "onPrimary" : "ink"}>
                {message.content}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* The timestamp sits on the canvas, outside the bubble, so it always
          takes the muted tone. It used to be text-violet-200 for own messages,
          which was near-invisible against the page rather than the bubble. */}
      <Text
        variant="caption"
        tone="muted"
        className={`mt-1 ${isMe ? "" : "pl-10"}`}
      >
        {format(new Date(message.sent_at), "h:mm a")}
      </Text>
    </View>
  );
}
