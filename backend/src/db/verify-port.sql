-- Proves a freshly migrated database actually behaves like the source.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/verify-port.sql
--
-- Seeds a small graph, exercises all five views, and asserts the subtle bits --
-- unread_count's boundary and the other_user_* correlated subqueries -- rather
-- than just checking the tables exist. Rolls back; nothing persists.

begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'PORT VERIFICATION FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end;
$$;

-- Reference data
insert into federations (id, code, name) values
  ('f0000000-0000-4000-8000-000000000001', 'IPF', 'International Powerlifting Federation');
insert into divisions (id, federation_id, name, minimum_age, maximum_age) values
  ('d0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Open', 14, null);
insert into weight_classes (id, federation_id, gender, name, min_weight, max_weight, sort_order, active) values
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Male', '83kg', 74, 83, 5, true);

-- Identity. Note ids are supplied explicitly: there is no auth.uid() default any
-- more, which is exactly what the API must now do from the verified JWT sub.
insert into users (id, email, username, first_name, last_name, gender, is_athlete, is_coach) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.invalid', 'alice', 'Alice', 'Anderson', 'Male', true, false),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.invalid',   'bob',   'Bob',   'Baker',    'Male', true, false),
  ('44444444-4444-4444-8444-444444444444', 'coach@example.invalid', 'coach', 'Cara',  'Coach',    'Female', false, true);

insert into athletes (id, federation_id, division_id, weight_class_id) values
  ('11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222', null, null, null);
insert into coaches (id, biography, years_of_experience) values
  ('44444444-4444-4444-8444-444444444444', 'Ten years under the bar.', 10);

insert into coach_athlete_relationships (athlete_id, coach_id, status) values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'active');
insert into coach_requests (athlete_id, coach_id, status) values
  ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'pending');

-- Messaging. Alice read at T0; two later messages from Bob and one of her own.
insert into conversations (id, name) values ('55555555-5555-4555-8555-555555555555', null);
insert into conversation_members (conversation_id, user_id, last_read_at) values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00Z'),
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', null);

insert into messages (conversation_id, user_id, content, message_type, created_at) values
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'before alice read', 'text', '2025-12-01T00:00:00Z'),
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'after alice read 1', 'text', '2026-02-01T00:00:00Z'),
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'after alice read 2', 'text', '2026-02-02T00:00:00Z'),
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'alice own message',  'text', '2026-02-03T00:00:00Z');

-- Programming
insert into exercises (id, name, created_by) values
  ('66666666-6666-4666-8666-666666666666', 'Squat', '44444444-4444-4444-8444-444444444444');
insert into workouts (id, athlete_id, coach_id, date, name) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '2026-02-04', 'W1D1');
-- A template: no athlete.
insert into workouts (athlete_id, coach_id, date, name, is_template) values
  (null, '44444444-4444-4444-8444-444444444444', '2026-02-04', 'Template A', true);
insert into workout_exercises (id, workout_id, exercise_id, "order") values
  ('88888888-8888-4888-8888-888888888888', '77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', 1);
insert into sets (workout_exercise_id, set_number, prescribed_reps, prescribed_intensity) values
  ('88888888-8888-4888-8888-888888888888', 1, 5, 'RPE 8');

-- ---------------------------------------------------------------------------
-- The views
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select count(*) from coach_athletes_view where coach_id = '44444444-4444-4444-8444-444444444444') = 1,
  'coach_athletes_view returns the coach''s one athlete');

select pg_temp.assert(
  (select federation_code from coach_athletes_view limit 1) = 'IPF',
  'coach_athletes_view resolves the reference-table left joins');

select pg_temp.assert(
  (select count(*) from messages_with_sender where conversation_id = '55555555-5555-4555-8555-555555555555') = 4,
  'messages_with_sender joins every message to its sender');

select pg_temp.assert(
  (select sender_first_name from messages_with_sender where content = 'alice own message') = 'Alice',
  'messages_with_sender renames user_id -> sender_id and carries sender fields');

-- One row per (conversation, member), so two here. This is why callers must
-- filter on user_id; without it the inbox shows a duplicate per participant.
select pg_temp.assert(
  (select count(*) from user_conversations_view) = 2,
  'user_conversations_view emits one row per member, not per conversation');

-- The subtle one: strictly newer than last_read_at, and excluding your own.
-- Alice read at 2026-01-01, so of the three later messages, the two from Bob
-- count and her own does not.
select pg_temp.assert(
  (select unread_count from user_conversations_view
    where user_id = '11111111-1111-4111-8111-111111111111') = 2,
  'unread_count is strictly > last_read_at and excludes your own messages');

-- Bob never read anything, so COALESCE to epoch means all three of Alice's...
-- except only one message is hers. Bob's own three do not count.
select pg_temp.assert(
  (select unread_count from user_conversations_view
    where user_id = '22222222-2222-4222-8222-222222222222') = 1,
  'unread_count COALESCEs a null last_read_at to the epoch');

select pg_temp.assert(
  (select other_user_name from user_conversations_view
    where user_id = '11111111-1111-4111-8111-111111111111') = 'Bob Baker',
  'other_user_name resolves the correlated subquery against the other member');

select pg_temp.assert(
  (select last_message_content from user_conversations_view
    where user_id = '11111111-1111-4111-8111-111111111111') = 'alice own message',
  'last_message_content picks the newest message');

select pg_temp.assert(
  (select count(*) from user_profiles_enriched_view) = 2,
  'user_profiles_enriched_view returns one row per athlete');

select pg_temp.assert(
  (select weight_class_name from user_profiles_enriched_view
    where athlete_id = '11111111-1111-4111-8111-111111111111') = '83kg',
  'user_profiles_enriched_view resolves its left joins');

-- Confirms the identity column really is athlete_id and there is no `id`.
select pg_temp.assert(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'user_profiles_enriched_view' and column_name = 'id'),
  'user_profiles_enriched_view has no `id` column, only athlete_id');

select pg_temp.assert(
  (select count(*) from user_coach_requests_view
    where athlete_id = '22222222-2222-4222-8222-222222222222') = 1,
  'user_coach_requests_view returns the pending request with coach details');

select pg_temp.assert(
  (select coach_username from user_coach_requests_view limit 1) = 'coach',
  'user_coach_requests_view joins through coaches to users');

-- ---------------------------------------------------------------------------
-- Constraints that must have survived the port
-- ---------------------------------------------------------------------------

do $$
begin
  insert into workouts (athlete_id, coach_id, date, name)
  values (null, null, '2026-02-05', 'no coach');
  raise exception 'PORT VERIFICATION FAILED: workouts.coach_id should be NOT NULL';
exception when not_null_violation then raise notice 'ok: workouts.coach_id is NOT NULL';
end $$;

do $$
begin
  insert into messages (conversation_id, user_id, content)
  values ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'no type');
  raise exception 'PORT VERIFICATION FAILED: messages.message_type should be NOT NULL with no default';
exception when not_null_violation then raise notice 'ok: messages.message_type is NOT NULL with no default';
end $$;

do $$
begin
  insert into athletes (id) values ('99999999-9999-4999-8999-999999999999');
  raise exception 'PORT VERIFICATION FAILED: athletes.id should reference users.id';
exception when foreign_key_violation then raise notice 'ok: athletes.id still references users.id';
end $$;

select pg_temp.assert(
  (select count(*) from workouts where athlete_id is null and is_template) = 1,
  'a template workout (null athlete_id) is permitted');

rollback;
