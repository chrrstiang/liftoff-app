import { View, Text, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Message } from "@/types/types";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useMemo } from "react";

const AVATAR_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;

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
    <View className={`flex-row mb-2 ${isMe ? "justify-end" : "justify-start"}`}>
      {!isMe && (
        <Image
          source={
            message.sender_avatar_url
              ? { uri: AVATAR_BASE_URL + message.sender_avatar_url }
              : require("@/assets/images/avatar-default.png")
          }
          className="w-8 h-8 rounded-full mr-2 self-end"
        />
      )}

      <View
        className={`max-w-[75%] rounded-2xl ${
          isMe
            ? "bg-violet-600 rounded-br-sm"
            : "bg-zinc-200 dark:bg-zinc-800 rounded-bl-sm"
        } ${message.message_type === "image" ? "p-1" : "px-4 py-2"}`}
      >
        {message.message_type === "image" ? (
          <View className="p-1">
            <Image
              key={message.id}
              source={imageSource}
              className="w-48 h-48 rounded-xl"
              contentFit="cover"
              transition={200}
              priority={isOptimistic ? "high" : "normal"}
            />
            {isOptimistic && (
              <View className="absolute inset-0 bg-black/20 rounded-xl items-center justify-center">
                <ActivityIndicator color="white" size="small" />
              </View>
            )}
          </View>
        ) : (
          <View className="px-4 py-2">
            <Text className="text-white text-base">{message.content}</Text>
          </View>
        )}

        <View className="mt-1">
          <Text
            className={`text-[10px] ${
              isMe ? "text-violet-200 text-right" : "text-gray-500"
            }`}
          >
            {format(new Date(message.sent_at), "h:mm a")}
          </Text>
        </View>
      </View>
    </View>
  );
}
