import {
  ActivityIndicator,
  FlatList,
  View,
  Pressable,
  Image as RNImage,
  Alert,
  TextInput,
  Platform,
  StyleSheet,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { MessageBubble } from "@/components/ChatBubble";
import { Avatar, EmptyState, Screen, Text } from "@/components/ui";
import { useTheme } from "@/theme/useTheme";
import { useLocalSearchParams, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Message } from "@/types/types";
import {
  fetchConversations,
  fetchMessageById,
  fetchMessages,
  markAsRead,
  sendMessage,
} from "@/lib/api/conversations";
import {
  ChevronLeft,
  ImagePlus,
  MessageCircle,
  SendHorizontal,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { uploadImageMessage } from "@/lib/api/storage";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { supabase } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

/** RNImage takes a style object, not a className. */
const styles = StyleSheet.create({
  attachmentPreview: { width: 128, height: 128, borderRadius: 12 },
});

export default function Conversation() {
  const [message, setMessage] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();

  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ["conversations", user?.id],
    queryFn: () => fetchConversations(user?.id || ""),
  });

  const {
    data: messages,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => {
      const messages = fetchMessages(conversationId);
      markAsRead(conversationId, user?.id || "");
      return messages;
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({
      text,
      imageUri,
    }: {
      text: string;
      imageUri: string;
    }) => {
      if (imageUri) {
        const uploadResponse = await uploadImageMessage(
          imageUri,
          conversationId
        );

        await sendMessage({
          conversation_id: conversationId,
          user_id: user?.id || "",
          content: "Sent an image",
          media_url: uploadResponse.path,
          message_type: "image",
        });
      }

      if (text) {
        await sendMessage({
          conversation_id: conversationId,
          user_id: user?.id || "",
          content: text,
          message_type: "text",
        });
      }
    },
    onMutate: async ({ text, imageUri }) => {
      await queryClient.cancelQueries({
        queryKey: ["messages", conversationId],
      });
      const previous = queryClient.getQueryData(["messages", conversationId]);

      const newMessages: Message[] = [];

      if (imageUri) {
        newMessages.push({
          id: Math.random().toString(),
          conversation_id: conversationId,
          content: "Image",
          sender_avatar_url: profile?.avatar_url || null,
          sender_first_name: profile?.first_name || "",
          sender_last_name: profile?.last_name || "",
          message_type: "image",
          media_url: imageUri,
          sender_id: user!.id,
          sent_at: new Date().toISOString(),
        });
      }

      if (text) {
        newMessages.push({
          id: Math.random().toString(),
          conversation_id: conversationId,
          content: text,
          sender_avatar_url: profile?.avatar_url || null,
          sender_first_name: profile?.first_name || "",
          sender_last_name: profile?.last_name || "",
          message_type: "text",
          media_url: null,
          sender_id: user!.id,
          sent_at: new Date().toISOString(),
        });
      }

      queryClient.setQueryData(
        ["messages", conversationId],
        (old: Message[] | undefined) => [...(old || []), ...newMessages]
      );

      return { previous };
    },
    onError: (error, newMessage, context) => {
      queryClient.setQueryData(["messages", conversationId], context?.previous);
      console.error("Failed to send message:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });

  // real-time listener for message insert
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          console.log("New payload for message", payload);

          const newMessage = await fetchMessageById(payload.new.id);

          if (newMessage) {
            queryClient.setQueryData<Message[]>(
              ["messages", conversationId],
              (old = []) => {
                if (old.some((m) => m.id === newMessage.id)) {
                  return old;
                }
                return [...old, newMessage];
              }
            );

            queryClient.invalidateQueries({
              queryKey: ["conversations", user.id],
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [user?.id, conversationId, queryClient]);

  const pickImage = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to upload images."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled) {
        const image = result.assets[0];
        setMediaUrl(image.uri);
        console.log("image.uri", image.uri);
      }
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to pick image. Please try again.");
    }
  };

  const handleSend = async () => {
    if ((!message.trim() && !mediaUrl) || !user?.id || !conversationId) return;

    const text = message.trim();
    const imageUri = mediaUrl || "";

    setMessage("");
    setMediaUrl(null);

    sendMessageMutation.mutate({
      text,
      imageUri,
    });
  };

  const currentConversation = conversations?.find(
    (conversation) => conversation.conversation_id === conversationId
  );

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  // currentConversation comes from a .find() and can miss — for example when a
  // thread is opened by id before the conversations list has resolved. The
  // header dereferences it, so guard here rather than crash.
  if (!messages || !currentConversation) {
    return (
      <Screen>
        <View className="flex-1 py-16">
          <EmptyState
            icon={MessageCircle}
            title="Conversation unavailable"
            body="This thread could not be loaded. Go back and open it again."
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        </View>
      </Screen>
    );
  }

  const canSend = Boolean(message.trim() || mediaUrl);

  return (
    <Screen edges={["top", "left", "right"]}>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-hairline px-4 py-3 dark:border-hairline-dark">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} strokeWidth={2} color={colors.ink} />
        </Pressable>

        <Avatar uri={currentConversation.avatar_url} size={40} />

        <View className="flex-1">
          <Text variant="heading" tone="ink" numberOfLines={1}>
            {currentConversation.name
              ? currentConversation.name
              : currentConversation.other_user_name}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={[...messages].reverse()}
          renderItem={({ item }) => (
            <MessageBubble message={item} isMe={item.sender_id === user?.id} />
          )}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          inverted={true}
          className="flex-1 px-4 py-4"
          showsVerticalScrollIndicator={false}
        />

        {/* Message Input */}
        <View className="border-t border-hairline bg-canvas px-3 pb-2 pt-2 dark:border-hairline-dark dark:bg-canvas-dark">
          {mediaUrl ? (
            <View className="relative mx-2 mb-2 self-start">
              <RNImage
                source={{ uri: mediaUrl }}
                style={styles.attachmentPreview}
                resizeMode="cover"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                onPress={() => {
                  setMediaUrl(null);
                }}
                className="absolute -right-2 -top-2 h-6 w-6 items-center justify-center rounded-pill bg-ink dark:bg-ink-dark"
              >
                <X size={14} strokeWidth={2.5} color={colors.canvas} />
              </Pressable>
            </View>
          ) : null}

          <View className="flex-row items-center gap-2 rounded-pill bg-surface px-3 py-1.5 dark:bg-surface-dark">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach an image"
              hitSlop={6}
              onPress={pickImage}
              className="p-1"
            >
              <ImagePlus size={22} strokeWidth={2} color={colors.muted} />
            </Pressable>

            <TextInput
              className="max-h-24 flex-1 px-1 py-2 font-inter text-body text-ink dark:text-ink-dark"
              placeholder="Type a message..."
              placeholderTextColor={colors.muted}
              value={message}
              onChangeText={setMessage}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              enablesReturnKeyAutomatically
              multiline
              editable
            />

            {/* Disabled state was previously invisible — the button looked
                identical whether or not there was anything to send. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              onPress={handleSend}
              disabled={!canSend}
              className={`h-9 w-9 items-center justify-center rounded-pill ${
                canSend
                  ? "bg-primary active:bg-primary-pressed dark:bg-primary-dark"
                  : "bg-primary-disabled dark:bg-primary-disabled-dark"
              }`}
            >
              <SendHorizontal
                size={18}
                strokeWidth={2}
                color={canSend ? colors.onPrimary : colors.muted}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
