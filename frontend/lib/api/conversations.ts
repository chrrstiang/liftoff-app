import { api } from "@/lib/api/client";
import type { Message, UserConversation } from "@/types";

/** Conversations and messages, through the API.
 *
 * Every function here used to take the caller's `userId` and pass it to Supabase
 * as a filter. They don't any more: the API derives the caller from the bearer
 * token, so an id parameter would be both redundant and a lie — passing someone
 * else's would change nothing.
 */

export async function fetchConversations() {
  return api.get<UserConversation[]>("/conversations");
}

/** Messages in a conversation, oldest first.
 *
 * ⚠️ **The API returns newest-first and this reverses it.** That is not an
 * oversight on either side: pagination has to select the most recent N, so the
 * query must order descending, while the thread renders chronologically. Reversing
 * here keeps the screen's contract identical to the Supabase version, which
 * ordered ascending and fetched *every* message in the thread with no limit —
 * fine at 35 messages, not at 35,000.
 */
export async function fetchMessages(conversationId: string, limit = 50) {
  const messages = await api.get<Message[]>(
    `/conversations/${conversationId}/messages?limit=${limit}`,
  );

  return [...messages].reverse();
}

/** Marks the thread read for the caller. */
export async function markAsRead(conversationId: string) {
  await api.post(`/conversations/${conversationId}/read`);
}

export interface SendMessageParams {
  conversation_id: string;
  content: string;
  message_type: string;
  media_url?: string;
}

/** Sends a message. `user_id` is gone from the payload — the sender is the token
 * holder, and letting the client name it meant anyone could post as anyone. */
export async function sendMessage({
  conversation_id,
  content,
  message_type,
  media_url,
}: SendMessageParams) {
  return api.post<{ id: string; sent_at: string }>(
    `/conversations/${conversation_id}/messages`,
    { content, message_type, media_url },
  );
}

/** Starts a conversation with another user, or returns the existing one.
 *
 * **This had no implementation at all before** — nothing in the app created a
 * conversation or a membership row, so messaging was unreachable for every new
 * user. It is idempotent, so tapping a name twice does not accumulate threads.
 */
export async function createConversation(participantId: string) {
  return api.post<{ conversation_id: string; message: string }>("/conversations", {
    participant_id: participantId,
  });
}
