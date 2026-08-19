-- MIGRATION 0001: the five views, verbatim from pg_get_viewdef() on the source Supabase database
-- (captured 2026-08-03). Applied after the Drizzle migration, since Drizzle does
-- not model views.
--
-- These port unchanged. None of them reference auth.uid(), which is what makes
-- the move mechanical -- a view that did would return NULL once auth lives in a
-- different database entirely.
--
-- NOTE: `security_invoker` is deliberately NOT set here. On Supabase it mattered
-- enormously (with it off, these views bypassed RLS and leaked every row in the
-- app). In RDS there is exactly one database role -- the API's -- and no RLS, so
-- invoker-vs-definer is moot. If RLS is ever introduced here, revisit this.

create or replace view coach_athletes_view as
 SELECT car.coach_id,
    car.athlete_id,
    u.first_name,
    u.last_name,
    u.username,
    u.avatar_url,
    f.code AS federation_code,
    d.name AS division_name,
    wc.name AS weight_class_name
   FROM coach_athlete_relationships car
     JOIN athletes a ON car.athlete_id = a.id
     JOIN users u ON a.id = u.id
     LEFT JOIN federations f ON a.federation_id = f.id
     LEFT JOIN divisions d ON a.division_id = d.id
     LEFT JOIN weight_classes wc ON a.weight_class_id = wc.id;

create or replace view messages_with_sender as
 SELECT m.id,
    m.conversation_id,
    m.content,
    m.user_id AS sender_id,
    m.created_at AS sent_at,
    m.message_type,
    m.media_url,
    u.first_name AS sender_first_name,
    u.last_name AS sender_last_name,
    u.avatar_url AS sender_avatar_url
   FROM messages m
     JOIN users u ON m.user_id = u.id;

create or replace view user_coach_requests_view as
 SELECT cr.id,
    cr.created_at,
    cr.coach_id,
    cr.athlete_id,
    cr.status,
    u.username AS coach_username,
    u.avatar_url AS coach_avatar_url
   FROM coach_requests cr
     JOIN coaches c ON cr.coach_id = c.id
     JOIN users u ON c.id = u.id;

-- Emits ONE ROW PER (conversation, member) pair, not one per conversation.
-- Callers must filter `where user_id = <caller>`; without it the inbox renders a
-- duplicate entry per participant.
--
-- unread_count is strictly `>` last_read_at and excludes your own messages.
-- Getting that boundary wrong presents as a permanently stuck unread badge.
create or replace view user_conversations_view as
 SELECT c.id AS conversation_id,
    c.name,
    c.avatar_url,
    c.updated_at,
    cm.user_id,
    cm.last_read_at,
    ( SELECT m.content
           FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_message_content,
    ( SELECT m.created_at
           FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_message_sent_at,
    ( SELECT m.user_id
           FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_message_sender_id,
    ( SELECT count(*) AS count
           FROM messages m
          WHERE m.conversation_id = c.id
            AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01 00:00:00'::timestamp without time zone::timestamp with time zone)
            AND m.user_id <> cm.user_id) AS unread_count,
    ( SELECT (u.first_name || ' '::text) || u.last_name
           FROM conversation_members cm2
             JOIN users u ON cm2.user_id = u.id
          WHERE cm2.conversation_id = c.id AND cm2.user_id <> cm.user_id
         LIMIT 1) AS other_user_name,
    ( SELECT u.avatar_url
           FROM conversation_members cm2
             JOIN users u ON cm2.user_id = u.id
          WHERE cm2.conversation_id = c.id AND cm2.user_id <> cm.user_id
         LIMIT 1) AS other_user_avatar_url,
    ( SELECT cm2.user_id
           FROM conversation_members cm2
          WHERE cm2.conversation_id = c.id AND cm2.user_id <> cm.user_id
         LIMIT 1) AS other_user_id
   FROM conversations c
     JOIN conversation_members cm ON c.id = cm.conversation_id;

-- Identity column is athlete_id. There is NO `id` column -- the reason the
-- exclusion filter in lib/api/athlete.ts compared against undefined and never
-- removed already-invited athletes.
create or replace view user_profiles_enriched_view as
 SELECT p.id AS athlete_id,
    p.first_name,
    p.last_name,
    p.username,
    p.avatar_url,
    a.federation_id,
    f.code AS federation_code,
    a.weight_class_id,
    wc.name AS weight_class_name,
    a.division_id,
    d.name AS division_name
   FROM users p
     JOIN athletes a ON p.id = a.id
     LEFT JOIN federations f ON a.federation_id = f.id
     LEFT JOIN weight_classes wc ON a.weight_class_id = wc.id
     LEFT JOIN divisions d ON a.division_id = d.id;
