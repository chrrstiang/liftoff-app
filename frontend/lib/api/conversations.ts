import { supabase } from "../supabase";

export async function fetchConversations(userId: string) {
  const { data, error } = await supabase
    .from("user_conversations_view")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching conversations:", error);
    return;
  }

  return data;
}

export async function fetchMessages(conversationId: string) {
  const { data, error } = await supabase
    .from("messages_with_sender")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error);
    return;
  }

  return data;
}

export interface SendMessageParams {
  conversation_id: string;
  user_id: string;
  content: string;
  message_type: string;
  media_url?: string;
}

export async function sendMessage(body: SendMessageParams) {
  const { data, error } = await supabase
    .from("messages")
    .insert([body])
    .select();

  if (error) {
    console.error("Error sending message:", error);
    throw error;
  }

  return data;
}
