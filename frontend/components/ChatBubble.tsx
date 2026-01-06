import { View, Text } from "react-native";
import { Image } from "expo-image";
import { Message } from "@/types/types";
import { format } from "date-fns";

export function MessageBubble({
  message,
  isMe,
}: {
  message: Message;
  isMe: boolean;
}) {
  return (
    <View className={`flex-row mb-2 ${isMe ? "justify-end" : "justify-start"}`}>
      {!isMe && (
        <Image
          source={
            message.sender_avatar_url
              ? { uri: message.sender_avatar_url }
              : require("@/assets/images/avatar-default.png")
          }
          className="w-8 h-8 rounded-full mr-2"
        />
      )}

      <View
        className={`max-w-[75%] px-4 py-2 rounded-2xl ${
          isMe
            ? "bg-violet-600 rounded-br-sm"
            : "bg-zinc-200 dark:bg-zinc-800 rounded-bl-sm"
        }`}
      >
        <Text
          className={isMe ? "text-white" : "text-foreground dark:text-white"}
        >
          {message.content}
        </Text>
        <Text
          className={`text-xs mt-1 ${isMe ? "text-violet-200" : "text-gray-500"}`}
        >
          {format(message.sent_at, "h:mm a")}
        </Text>
      </View>
    </View>
  );
}
