import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { UserConversation } from "@/types/types";
import { Image } from "expo-image";
import { FontAwesome } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchConversations } from "@/lib/api/conversations";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "expo-router";

export default function ConversationsScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConversations(user?.id || ""),
  });

  const renderConversation = ({ item }: { item: UserConversation }) => (
    <TouchableOpacity
      onPress={() => {
        console.log(`Conversation: ${item.name}`);
        router.push(`/conversations/${item.conversation_id}`);
      }}
      className="bg-white dark:bg-zinc-900 p-4 mx-4 my-1 rounded-lg flex-row items-center"
      activeOpacity={0.8}
    >
      <View className="relative">
        <Image
          source={
            item.avatar_url
              ? {
                  uri: item.avatar_url,
                }
              : require("@/assets/images/avatar-default.png")
          }
          className="w-14 h-14 rounded-full"
          contentFit="cover"
          placeholder={require("@/assets/images/avatar-default.png")}
          key={item.avatar_url}
        />
        {item.unread_count > 0 && (
          <View className="absolute -top-1 -right-1 bg-violet-500 rounded-full w-5 h-5 items-center justify-center">
            <Text className="text-white text-xs font-bold">
              {item.unread_count}
            </Text>
          </View>
        )}
      </View>

      <View className="ml-4 flex-1">
        <View className="flex-row justify-between items-center">
          <Text className="text-base font-semibold text-foreground dark:text-white">
            {item.name ? item.name : item.other_user_name}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {new Date(item.last_message_sent_at || "").toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>

        <View className="flex-row items-center mt-1">
          <Text
            className={`text-sm flex-1 ${item.unread_count > 0 ? "font-semibold text-foreground dark:text-white" : "text-gray-500 dark:text-gray-400"}`}
            numberOfLines={1}
          >
            {item.last_message_content || "No messages yet"}
          </Text>
          {item.unread_count > 0 && (
            <View className="w-2 h-2 rounded-full bg-violet-500 ml-2" />
          )}
        </View>
      </View>

      <FontAwesome
        name="chevron-right"
        size={14}
        color="#9ca3af"
        style={styles.icon}
      />
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background dark:bg-zinc-950">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-zinc-950">
      <View className="py-4 px-6">
        <Text className="text-3xl font-bold text-foreground dark:text-white">
          Messages
        </Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversation_id}
        renderItem={renderConversation}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-gray-500 dark:text-gray-400 text-center">
              No conversations yet
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: 8,
  },
  icon: {
    marginLeft: 8,
  },
});
