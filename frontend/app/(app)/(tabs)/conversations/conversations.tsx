import { Avatar, EmptyState, Screen, Text } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { fetchConversations } from "@/lib/api/conversations";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme/useTheme";
import { UserConversation } from "@/types/types";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ChevronRight, MessageCircle } from "lucide-react-native";
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

/** contentContainerStyle takes a style object, not a className. */
const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
});

export default function ConversationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", user?.id],
    queryFn: () => fetchConversations(user?.id || ""),
  });

  // real-time listener for conversation update
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("user_conversations")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        () => {
          console.log("Trigger for conversation update, invalidating queries");
          queryClient.invalidateQueries({
            queryKey: ["conversations", user?.id],
          });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [user?.id, queryClient]);

  const renderConversation = ({ item }: { item: UserConversation }) => {
    const unread = item.unread_count > 0;

    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          console.log(`Conversation: ${item.name}`);
          router.push(`/conversations/${item.conversation_id}`);
        }}
        className="flex-row items-center gap-4 px-6 py-4 active:bg-surface dark:active:bg-surface-dark"
      >
        <View className="relative">
          <Avatar uri={item.avatar_url} />
          {/* Ink rather than coral: an unread count is a marker, not an action. */}
          {unread ? (
            <View className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-pill bg-ink px-1 dark:bg-ink-dark">
              <Text variant="overline" tone="onInk">
                {item.unread_count}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center justify-between">
            <Text variant="bodyStrong" tone="ink" numberOfLines={1}>
              {item.name ? item.name : item.other_user_name}
            </Text>
            <Text variant="caption" tone="muted">
              {new Date(item.last_message_sent_at || "").toLocaleTimeString(
                [],
                {
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )}
            </Text>
          </View>

          <Text
            variant={unread ? "bodyStrong" : "body"}
            tone={unread ? "ink" : "muted"}
            numberOfLines={1}
          >
            {item.last_message_content || "No messages yet"}
          </Text>
        </View>

        <ChevronRight size={18} strokeWidth={2} color={colors.muted} />
      </Pressable>
    );
  };

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <View className="px-6 pb-2 pt-4">
        <Text variant="title" tone="ink">
          Messages
        </Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversation_id}
        renderItem={renderConversation}
        ItemSeparatorComponent={() => (
          <View className="ml-24 h-px bg-hairline dark:bg-hairline-dark" />
        )}
        contentContainerStyle={
          conversations?.length ? undefined : styles.grow
        }
        ListEmptyComponent={
          <View className="flex-1 py-16">
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              body="Messages with your coach or athletes will show up here."
            />
          </View>
        }
      />
    </Screen>
  );
}
