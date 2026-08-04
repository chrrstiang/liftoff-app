/** Messaging shapes. */

/** A row from `user_conversations_view`.
 *
 * ⚠️ The view emits **one row per (conversation, member) pair**, not one per
 * conversation. `lib/api/conversations.ts` filters with `.eq("user_id", userId)`,
 * and that filter is load-bearing — without it the inbox renders a duplicate entry
 * per participant. Pinned by supabase/tests/rls_regression.sql.
 *
 * `unread_count` counts messages strictly newer than `last_read_at` and excludes
 * your own. See docs/DB-SCHEMA.md for the exact expression.
 */
export type UserConversation = {
  conversation_id: string;
  name: string | null;
  avatar_url: string | null;
  updated_at: string;
  user_id: string;
  last_read_at: string | null;
  last_message_content: string | null;
  last_message_sent_at: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
  other_user_id: string | null;
};

/** A row from `messages_with_sender`, which renames `user_id` to `sender_id` and
 * `created_at` to `sent_at`.
 *
 * ⚠️ `id` doubles as an optimistic-state marker: ChatBubble treats
 * `id.length < 30` as "still sending", because optimistic messages use
 * `Math.random().toString()` while real rows are uuids. Any id generated
 * elsewhere that happens to be ≥30 chars silently breaks the pending state.
 */
export type Message = {
  id: string;
  conversation_id: string;
  content: string;
  sender_id: string;
  sender_avatar_url: string | null;
  sender_first_name: string;
  sender_last_name: string;
  sent_at: string;
  message_type: "text" | "image" | "video" | "file";
  media_url: string | null;
};
