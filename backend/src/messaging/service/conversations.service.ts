import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { conversationMembers, conversations, messages, users } from 'src/db/schema';

/** Conversations and messages.
 *
 * ⚠️ **No RLS behind any of this.** Membership is the authorization for every
 * operation here, and it is always checked against the stored
 * `conversation_members` rows — never against anything the client sends.
 *
 * On Supabase this was the worst hole in the schema: `conversation_members` had
 * `SELECT true` and `INSERT true` for `public`, so anyone could add themselves to
 * any thread and then read it. The rules below are what replace that.
 */
@Injectable()
export class ConversationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** True when the caller is a member. The single gate every other method uses. */
  private async assertMember(conversationId: string, callerId: string): Promise<void> {
    const [member] = await this.db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, callerId),
        ),
      )
      .limit(1);

    // A 404 rather than a 403, deliberately: telling a stranger that a
    // conversation exists but is not theirs leaks who is talking to whom.
    if (!member) {
      throw new NotFoundException(`Conversation with ID ${conversationId} could not be found`);
    }
  }

  /** Creates a one-to-one conversation between the caller and one other user.
   *
   * Both membership rows are written inside a transaction, so a conversation can
   * never exist with only one participant — which is the state that would make a
   * thread visible to nobody and undeletable through the API.
   *
   * Idempotent: if the pair already has a conversation, the existing one is
   * returned rather than accumulating duplicates every time someone taps a name.
   */
  async createConversation(participantId: string, callerId: string) {
    if (participantId === callerId) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }

    const [participant] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, participantId))
      .limit(1);

    if (!participant) {
      throw new NotFoundException(`User with ID ${participantId} could not be found`);
    }

    // An existing one-to-one thread is any conversation both users belong to.
    const existing = await this.db
      .select({ id: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, callerId));

    if (existing.length > 0) {
      const [shared] = await this.db
        .select({ id: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.userId, participantId),
            sql`${conversationMembers.conversationId} in ${existing.map((e) => e.id)}`,
          ),
        )
        .limit(1);

      if (shared) return { id: shared.id, created: false };
    }

    const id = await this.db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({}).returning({
        id: conversations.id,
      });

      await tx.insert(conversationMembers).values([
        { conversationId: conversation.id, userId: callerId },
        { conversationId: conversation.id, userId: participantId },
      ]);

      return conversation.id;
    });

    return { id, created: true };
  }

  /** The caller's inbox. Replaces `user_conversations_view`.
   *
   * The view emitted one row per (conversation, member) pair and relied on the
   * caller filtering by `user_id` — omitting that filter rendered a duplicate
   * entry per participant. Binding the caller's id here makes that impossible.
   *
   * `unread_count` preserves the view's exact semantics: strictly newer than
   * `last_read_at`, and excluding your own messages. Getting the boundary wrong
   * presents as a permanently stuck badge.
   */
  async listConversations(callerId: string) {
    const other = sql`(
      select cm2.user_id from conversation_members cm2
      where cm2.conversation_id = ${conversations.id} and cm2.user_id <> ${callerId}
      limit 1
    )`;

    return this.db
      .select({
        conversation_id: conversations.id,
        name: conversations.name,
        avatar_url: conversations.avatarUrl,
        updated_at: conversations.updatedAt,
        user_id: conversationMembers.userId,
        last_read_at: conversationMembers.lastReadAt,
        last_message_content: sql<string | null>`(
          select m.content from messages m where m.conversation_id = ${conversations.id}
          order by m.created_at desc limit 1)`,
        last_message_sent_at: sql<string | null>`(
          select m.created_at from messages m where m.conversation_id = ${conversations.id}
          order by m.created_at desc limit 1)`,
        last_message_sender_id: sql<string | null>`(
          select m.user_id from messages m where m.conversation_id = ${conversations.id}
          order by m.created_at desc limit 1)`,
        unread_count: sql<number>`(
          select count(*)::int from messages m
          where m.conversation_id = ${conversations.id}
            and m.created_at > coalesce(${conversationMembers.lastReadAt}, 'epoch'::timestamptz)
            and m.user_id <> ${callerId})`,
        other_user_id: other,
        other_user_name: sql<string | null>`(
          select u.first_name || ' ' || u.last_name from users u where u.id = ${other})`,
        other_user_avatar_url: sql<string | null>`(
          select u.avatar_url from users u where u.id = ${other})`,
      })
      .from(conversations)
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .where(eq(conversationMembers.userId, callerId))
      .orderBy(desc(conversations.updatedAt));
  }

  /** Messages in a conversation the caller belongs to.
   *
   * Paginated, unlike the Supabase version which fetched every message in a
   * thread with no limit — fine at 35 messages, not at 35,000.
   */
  async listMessages(conversationId: string, callerId: string, limit = 50, before?: string) {
    await this.assertMember(conversationId, callerId);

    const conditions = [eq(messages.conversationId, conversationId)];
    if (before) conditions.push(sql`${messages.createdAt} < ${before}`);

    return this.db
      .select({
        id: messages.id,
        conversation_id: messages.conversationId,
        content: messages.content,
        sender_id: messages.userId,
        sent_at: messages.createdAt,
        message_type: messages.messageType,
        media_url: messages.mediaUrl,
        sender_first_name: users.firstName,
        sender_last_name: users.lastName,
        sender_avatar_url: users.avatarUrl,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.userId))
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(Math.min(limit, 100));
  }

  /** Sends a message. The sender is the caller and the conversation comes from the
   * route, so neither is spoofable. Bumps the conversation's updated_at in the
   * same transaction so the inbox ordering cannot drift from the messages. */
  async sendMessage(
    conversationId: string,
    callerId: string,
    content: string,
    messageType: 'text' | 'image' | 'video' | 'file' = 'text',
    mediaUrl?: string,
  ) {
    await this.assertMember(conversationId, callerId);

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          conversationId,
          userId: callerId,
          content,
          messageType,
          mediaUrl: mediaUrl ?? null,
        })
        .returning({ id: messages.id, createdAt: messages.createdAt });

      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

      return created;
    });
  }

  /** Marks the caller's own membership as read. Scoped to their row, so one
   * member can never clear another's unread count. */
  async markAsRead(conversationId: string, callerId: string) {
    await this.assertMember(conversationId, callerId);

    await this.db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, callerId),
        ),
      );
  }
}
