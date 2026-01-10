import {
  ActivityIndicator,
  FlatList,
  View,
  Text,
  TouchableOpacity,
  Image as RNImage,
  Alert,
  TextInput,
  Platform,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { MessageBubble } from "@/components/ChatBubble";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Message } from "@/types/types";
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
} from "@/lib/api/conversations";
import { FontAwesome } from "@expo/vector-icons";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { uploadImageMessage } from "@/lib/api/storage";
import { Image } from "expo-image";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

export default function Conversation() {
  const [message, setMessage] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const { user, profile } = useAuth();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();

  const queryClient = useQueryClient();

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConversations(user?.id || ""),
  });

  const {
    data: messages,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => fetchMessages(conversationId),
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
      <KeyboardAvoidingView
        className="flex-1 pt-10"
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
        <View className="bg-background dark:bg-zinc-950 px-3 pb-2">
          {mediaUrl && (
            <View className="relative mb-2 mx-2">
              <RNImage
                source={{ uri: mediaUrl }}
                className="w-32 h-32 rounded-lg"
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => {
                  setMediaUrl(null);
                }}
                className="absolute -top-2 -right-2 bg-red-500 rounded-full w-6 h-6 items-center justify-center"
              >
                <FontAwesome name="times" size={14} color="white" />
              </TouchableOpacity>
            </View>
          )}
          <View className="flex-row items-center bg-gray-100 dark:bg-zinc-800 rounded-full px-4 py-2">
            <TouchableOpacity onPress={pickImage} className="p-2 mr-2">
              <FontAwesome name="image" size={24} color="#7c3aed" />
            </TouchableOpacity>
            <TextInput
              className="flex-1 text-foreground dark:text-white text-base py-2 px-2"
              placeholder="Type a message..."
              placeholderTextColor="#9ca3af"
              value={message}
              onChangeText={setMessage}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              enablesReturnKeyAutomatically
              multiline
              editable
            />
            <TouchableOpacity
              onPress={handleSend}
              className="ml-2 p-2 bg-primary rounded-full"
              disabled={!message.trim() && !mediaUrl}
            >
              <FontAwesome name="send" size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
