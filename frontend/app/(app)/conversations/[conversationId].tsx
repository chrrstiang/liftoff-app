import {
  ActivityIndicator,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { MessageBubble } from "@/components/ChatBubble";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { fetchConversations, fetchMessages } from "@/lib/api/conversations";
import { Image } from "expo-image";
import { FontAwesome } from "@expo/vector-icons";

export default function Conversation() {
  const { user } = useAuth();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConversations(user?.id || ""),
  });

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => fetchMessages(conversationId),
  });

  const currentConversation = conversations?.find(
    (conversation) => conversation.conversation_id === conversationId
  );

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  if (!messages) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <Text className="text-gray-500 dark:text-gray-400">
          No messages found
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center p-4 border-b border-gray-200 dark:border-zinc-800">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mr-4 p-2 -ml-2"
        >
          <FontAwesome name="chevron-left" size={20} color="#6b7280" />
        </TouchableOpacity>
        <Image
          source={
            currentConversation.avatar_url
              ? {
                  uri: currentConversation.avatar_url,
                }
              : require("@/assets/images/avatar-default.png")
          }
          className="w-10 h-10 rounded-full mr-3"
          contentFit="cover"
        />

        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground dark:text-white">
            {currentConversation.name
              ? currentConversation.name
              : currentConversation.other_user_name}
          </Text>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        className="flex-1 px-3"
        contentContainerStyle={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets={true}
      >
        <View className="space-y-3 pt-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isMe={message.sender_id === user?.id}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingBottom: 80,
  },
});
