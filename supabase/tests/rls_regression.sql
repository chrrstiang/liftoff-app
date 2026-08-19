-- RLS regression tests.
--
-- Each block re-attempts one of the attacks that worked before
-- 20260804040000_harden_rls_policies.sql. Every assertion raises an exception on
-- failure, so the script either runs to completion or aborts on the first
-- regression.
--
-- HOW TO RUN
--   Against the live project (read-heavy, but it does seed and roll back):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_regression.sql
--   Against a scratch Postgres: load the schema first, then this.
--
-- Impersonation works the way Supabase's own auth.uid() reads identity -- from the
-- request.jwt.claim.sub GUC -- so `set role authenticated` plus that setting is a
-- faithful stand-in for a real anon-key request.
--
-- Everything runs inside a transaction that is ROLLED BACK at the end. Nothing is
-- persisted, including on a live database.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Deliberately bypasses RLS (we are still the table owner here).
-- ---------------------------------------------------------------------------

create temporary table t_ids (label text primary key, id uuid);
insert into t_ids values
  ('alice',    '11111111-1111-1111-1111-111111111111'),
  ('bob',      '22222222-2222-2222-2222-222222222222'),
  ('mallory',  '33333333-3333-3333-3333-333333333333'),
  ('coach',    '44444444-4444-4444-4444-444444444444'),
  ('convo',    '55555555-5555-5555-5555-555555555555');

insert into public.users (id, email, username, first_name, last_name, is_athlete, is_coach)
select id, label || '@rls-test.invalid', 'rls_' || label, initcap(label), 'Test',
       label in ('alice','bob','mallory'), label = 'coach'
from t_ids where label <> 'convo';

insert into public.athletes (id)
select id from t_ids where label in ('alice','bob','mallory');
insert into public.coaches (id)
select id from t_ids where label = 'coach';

insert into public.conversations (id, name)
values ((select id from t_ids where label='convo'), 'Alice and Bob');

insert into public.conversation_members (conversation_id, user_id)
select (select id from t_ids where label='convo'), id
from t_ids where label in ('alice','bob');

insert into public.messages (conversation_id, user_id, content, message_type)
select (select id from t_ids where label='convo'),
       (select id from t_ids where label='alice'),
       'private message between alice and bob',
       (enum_first(null::public.message_type_enum));

-- A coach-owned workout assigned to alice, with one exercise and one set.
insert into public.exercises (id, name, created_by)
values ('66666666-6666-6666-6666-666666666666', 'Squat',
        (select id from t_ids where label='coach'));

insert into public.coach_athlete_relationships (athlete_id, coach_id, status)
values ((select id from t_ids where label='alice'),
        (select id from t_ids where label='coach'),
        'active');

insert into public.workouts (id, athlete_id, coach_id, date, name)
values ('77777777-7777-7777-7777-777777777777',
        (select id from t_ids where label='alice'),
        (select id from t_ids where label='coach'),
        current_date, 'Week 1 Day 1');

insert into public.workout_exercises (id, workout_id, exercise_id)
values ('88888888-8888-8888-8888-888888888888',
        '77777777-7777-7777-7777-777777777777',
        '66666666-6666-6666-6666-666666666666');

insert into public.sets (id, workout_exercise_id, set_number, prescribed_reps)
values ('99999999-9999-9999-9999-999999999999',
        '88888888-8888-8888-8888-888888888888', 1, 5);

-- ---------------------------------------------------------------------------
-- Helper: run an assertion as a given user.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'RLS REGRESSION: %', msg;
  end if;
  raise notice 'ok: %', msg;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finding A0 + A: Mallory must not be able to read Alice and Bob's messages.
--
-- Before the fix this returned every message in the application, because
-- messages_with_sender ran with security_invoker off.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select pg_temp.assert(
  (select count(*) from public.messages_with_sender) = 0,
  'messages_with_sender leaks nothing to a non-member (A0)');

select pg_temp.assert(
  (select count(*) from public.messages) = 0,
  'messages table leaks nothing to a non-member');

select pg_temp.assert(
  (select count(*) from public.user_conversations_view) = 0,
  'user_conversations_view leaks nothing to a non-member (A0)');

select pg_temp.assert(
  (select count(*) from public.conversations) = 0,
  'conversations leaks nothing to a non-member');

select pg_temp.assert(
  (select count(*) from public.conversation_members) = 0,
  'conversation_members is not world-readable (A)');

-- The original exploit: insert yourself into someone else's conversation.
do $$
begin
  insert into public.conversation_members (conversation_id, user_id)
  values ('55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333');
  raise exception 'RLS REGRESSION: mallory joined a conversation she is not in (A)';
exception
  when insufficient_privilege then raise notice 'ok: self-join into a foreign conversation is denied (A)';
end $$;

-- Finding B: posting into a conversation you are not in.
do $$
begin
  insert into public.messages (conversation_id, user_id, content, message_type)
  values ('55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333', 'injected',
          enum_first(null::public.message_type_enum));
  raise exception 'RLS REGRESSION: mallory posted into a foreign conversation (B)';
exception
  when insufficient_privilege then raise notice 'ok: posting into a foreign conversation is denied (B)';
end $$;

-- Finding D: fabricate a coach/athlete relationship with no accepted request.
do $$
begin
  insert into public.coach_athlete_relationships (athlete_id, coach_id, status)
  values ('33333333-3333-3333-3333-333333333333',
          '44444444-4444-4444-4444-444444444444', 'active');
  raise exception 'RLS REGRESSION: fabricated a coach/athlete relationship (D)';
exception
  when insufficient_privilege then raise notice 'ok: fabricating a relationship is denied (D)';
end $$;

-- Finding E: rewrite another athlete's logged set.
select pg_temp.assert(
  (select count(*) from public.sets) = 0,
  'sets belonging to another athlete are not visible (E)');

do $$
declare n integer;
begin
  update public.sets set actual_load = 999
   where id = '99999999-9999-9999-9999-999999999999';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS REGRESSION: mallory updated another athlete''s set (E)';
  end if;
  raise notice 'ok: updating another athlete''s set affects 0 rows (E)';
end $$;

-- Finding F: the users table is no longer world-readable to anon.
select pg_temp.assert(
  (select count(*) from public.workouts) = 0,
  'workouts belonging to others are not visible (C)');

-- Finding G: cannot edit another user's profile row.
do $$
declare n integer;
begin
  update public.users set avatar_url = 'hacked'
   where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS REGRESSION: mallory updated another user''s row (G)';
  end if;
  raise notice 'ok: updating another user''s row affects 0 rows (G)';
end $$;

-- Column privilege: even on her OWN row, only avatar_url is writable.
do $$
begin
  update public.users set date_of_birth = '1990-01-01'
   where id = '33333333-3333-3333-3333-333333333333';
  raise exception 'RLS REGRESSION: a non-avatar column was writable from the client (G)';
exception
  when insufficient_privilege then raise notice 'ok: only avatar_url is client-writable on users (G)';
end $$;

-- ---------------------------------------------------------------------------
-- Positive cases. The fix must not break what is supposed to work.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.assert(
  (select count(*) from public.messages_with_sender) = 1,
  'alice still reads her own conversation''s messages');

-- NOTE: this view emits one row per (conversation, member) pair, and
-- conversation_members SELECT is scoped to co-membership rather than
-- `user_id = auth.uid()` on purpose -- user_conversations_view derives
-- other_user_name from the *other* member's row and returns NULL under the
-- narrower rule. So an unfiltered count here is 2, not 1.
--
-- That makes the `.eq("user_id", userId)` filter in lib/api/conversations.ts
-- load-bearing rather than cosmetic: without it the inbox renders a duplicate
-- entry per participant. Asserting the shape the app actually queries.
select pg_temp.assert(
  (select count(*) from public.user_conversations_view
    where user_id = '11111111-1111-1111-1111-111111111111') = 1,
  'alice sees exactly one inbox row for her conversation');

select pg_temp.assert(
  (select count(*) from public.user_conversations_view) = 2,
  'the view still exposes both member rows, which other_user_name depends on');

select pg_temp.assert(
  (select other_user_name from public.user_conversations_view
    where user_id = '11111111-1111-1111-1111-111111111111') = 'Bob Test',
  'other_user_name still resolves (co-membership visibility)');

select pg_temp.assert(
  (select count(*) from public.sets) = 1,
  'alice still sees the sets on her own workout');

do $$
declare n integer;
begin
  update public.sets set actual_load = 100, is_completed = true
   where id = '99999999-9999-9999-9999-999999999999';
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'alice can still log her own set');
end $$;

do $$
declare n integer;
begin
  update public.users set avatar_url = 'https://example.invalid/a.png'
   where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'alice can still update her own avatar');
end $$;

-- The coach side.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select pg_temp.assert(
  (select count(*) from public.coach_athletes_view) = 1,
  'coach still sees their roster through coach_athletes_view');

select pg_temp.assert(
  (select count(*) from public.workouts) = 1,
  'coach still sees the workout they authored');

do $$
declare n integer;
begin
  insert into public.workouts (athlete_id, coach_id, date, name)
  values ('11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444', current_date, 'Week 1 Day 2');
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'coach can still program for their own athlete');
end $$;

-- ...but not for an athlete who is not theirs.
do $$
begin
  insert into public.workouts (athlete_id, coach_id, date, name)
  values ('33333333-3333-3333-3333-333333333333',
          '44444444-4444-4444-4444-444444444444', current_date, 'unauthorized');
  raise exception 'RLS REGRESSION: coach programmed for an unrelated athlete (B)';
exception
  when insufficient_privilege then raise notice 'ok: coach cannot program for an unrelated athlete (B)';
end $$;

-- Anon must see nothing at all.
reset role;
set local role anon;
set local request.jwt.claim.sub = '';

select pg_temp.assert(
  (select count(*) from public.users) = 0,
  'anon cannot read the users table (F)');

select pg_temp.assert(
  (select count(*) from public.user_profiles_enriched_view) = 0,
  'anon cannot read profiles through the enriched view (A0/F)');

reset role;

rollback;
