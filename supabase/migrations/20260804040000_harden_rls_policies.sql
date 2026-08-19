-- Harden RLS across the public schema.
--
-- WHY THIS IS ONE FILE: every statement here is part of a single authorization
-- change. Enabling security_invoker on the views (section 1) while the base-table
-- policies (sections 3+) are still permissive just trades one wrong answer for
-- another. Each migration file runs in its own transaction, so keeping this
-- together is what makes the change atomic.
--
-- Findings addressed (see docs/DB-SCHEMA.md and the plan):
--   A0  all 5 views ran with security_invoker off -> RLS bypassed entirely
--   A   conversation_members was world-readable AND world-insertable
--   B   three policies compared a column to itself (always true)
--   C   blanket "authenticated only" policies OR'd away the scoped ones
--   D   coach_athlete_relationships INSERT was with_check(true)
--   E   sets UPDATE was auth.role() = 'authenticated' (any user, any set)
--   F   users SELECT was `true` to `public` -> anon key could dump the table
--   G   users UPDATE was keyed on the JWT email claim, not the id
--   H   exercise_templates UPDATE was true/true
--
-- Requires PostgreSQL 15+ for `security_invoker` on views.

begin;

-- ---------------------------------------------------------------------------
-- 0. Make sure RLS is actually on
--
-- pg_policies lists policies but says nothing about whether row security is
-- enabled on the table. A policy on a table with RLS disabled is inert and the
-- table is wide open, which would make everything below theatre. These are
-- idempotent, so running them costs nothing if RLS was already on.
--
-- `teams` appears in no policy at all and has an incoming FK from
-- athletes.team_id. Nothing in the app reads or writes it. Enabling RLS with no
-- policy denies all client access, which is the correct default for an unused
-- table -- the backend's service-role key is unaffected.
-- ---------------------------------------------------------------------------

alter table public.users                          enable row level security;
alter table public.athletes                       enable row level security;
alter table public.coaches                        enable row level security;
alter table public.teams                          enable row level security;
alter table public.coach_requests                 enable row level security;
alter table public.coach_athlete_relationships    enable row level security;
alter table public.conversations                  enable row level security;
alter table public.conversation_members           enable row level security;
alter table public.messages                       enable row level security;
alter table public.workouts                       enable row level security;
alter table public.workout_exercises              enable row level security;
alter table public.sets                           enable row level security;
alter table public.exercises                      enable row level security;
alter table public.exercise_templates             enable row level security;
alter table public.exercise_default_set_templates enable row level security;
alter table public.federations                    enable row level security;
alter table public.divisions                      enable row level security;
alter table public.weight_classes                 enable row level security;

-- ---------------------------------------------------------------------------
-- 1. Authorization helper functions
--
-- These are SECURITY DEFINER on purpose. A policy on table T that subqueries T
-- recurses ("infinite recursion detected in policy for relation ..."), which is
-- exactly the trap the previous conversation_members UPDATE policy was in.
-- Running as the owner bypasses RLS inside the function and breaks the cycle.
--
-- search_path is pinned on every one of them: a SECURITY DEFINER function with a
-- mutable search_path is a privilege-escalation vector.
-- ---------------------------------------------------------------------------

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = (select auth.uid())
  );
$$;

comment on function public.is_conversation_member(uuid) is
  'True when the calling user is a member of the given conversation. SECURITY DEFINER to avoid RLS recursion on conversation_members.';

create or replace function public.is_coach_of(p_athlete_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.coach_athlete_relationships r
    where r.athlete_id = p_athlete_id
      and r.coach_id = (select auth.uid())
      and r.status = 'active'
  );
$$;

comment on function public.is_coach_of(uuid) is
  'True when the calling user is the active coach of the given athlete.';

-- Athlete or coach on the workout. athlete_id is nullable: a NULL athlete_id
-- means a template, which only its owning coach may reach.
create or replace function public.can_access_workout(p_workout_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.workouts w
    where w.id = p_workout_id
      and (
        w.coach_id = (select auth.uid())
        or (w.athlete_id is not null and w.athlete_id = (select auth.uid()))
      )
  );
$$;

comment on function public.can_access_workout(uuid) is
  'True when the calling user is the assigned athlete or the owning coach of the workout.';

-- One hop up from a set: sets -> workout_exercises -> workouts.
create or replace function public.can_access_workout_exercise(p_workout_exercise_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where we.id = p_workout_exercise_id
      and (
        w.coach_id = (select auth.uid())
        or (w.athlete_id is not null and w.athlete_id = (select auth.uid()))
      )
  );
$$;

comment on function public.can_access_workout_exercise(uuid) is
  'True when the calling user may reach the workout that owns the given workout_exercise.';

-- Coach-only mutations need to know the caller is actually a coach.
create or replace function public.is_coach()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.coaches c where c.id = (select auth.uid())
  );
$$;

comment on function public.is_coach() is 'True when the calling user has a coaches row.';

revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.is_coach_of(uuid) from public;
revoke all on function public.can_access_workout(uuid) from public;
revoke all on function public.can_access_workout_exercise(uuid) from public;
revoke all on function public.is_coach() from public;

grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.is_coach_of(uuid) to authenticated;
grant execute on function public.can_access_workout(uuid) to authenticated;
grant execute on function public.can_access_workout_exercise(uuid) to authenticated;
grant execute on function public.is_coach() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Finding A0 — make the views respect RLS
--
-- With security_invoker off (the default), a view executes with its owner's
-- privileges, so RLS on the base tables never runs. `select * from
-- messages_with_sender` returned every message in the application to any holder
-- of the anon key. None of these views reference auth.uid(), so turning invoker
-- semantics on is safe and does not change their shape.
-- ---------------------------------------------------------------------------

alter view public.coach_athletes_view          set (security_invoker = on);
alter view public.messages_with_sender         set (security_invoker = on);
alter view public.user_conversations_view      set (security_invoker = on);
alter view public.user_coach_requests_view     set (security_invoker = on);
alter view public.user_profiles_enriched_view  set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 3. Finding F/G — users
--
-- SELECT moves from `public` (which includes anon) to `authenticated`. This is
-- what closes "anyone with the bundled anon key can dump the user table".
--
-- Row-level scoping cannot hide date_of_birth and email from other signed-in
-- users -- that needs column privileges, which in turn needs a GET /users/me
-- endpoint so an owner can still read their own full row. Tracked as a follow-up;
-- see docs/DB-SCHEMA.md.
--
-- UPDATE is rekeyed from the JWT email claim to the id. The old form worked only
-- because users.email happens to be NOT NULL, and it silently locked a user out
-- of their own row the moment they changed their auth email.
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.users;
create policy "users_select_authenticated"
  on public.users for select to authenticated
  using (true);

drop policy if exists "Enable update for users based on email" on public.users;
create policy "users_update_own"
  on public.users for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- The only client-side write to users is the avatar (lib/api/storage.ts). Every
-- other column is written by the backend under the service-role key, which is
-- not subject to these grants.
revoke update on public.users from authenticated;
grant update (avatar_url) on public.users to authenticated;

-- INSERT policy ("Enable insert for users based on id") is already correct:
-- with_check ((select auth.uid()) = id). Left as-is.

-- ---------------------------------------------------------------------------
-- 4. athletes / coaches
--
-- athletes deliberately keeps NO insert policy: profile creation runs through
-- POST /users/profile under the service-role key, and that is the only path that
-- should create one. coaches tightens from with_check(true) to owner-only.
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.athletes;
create policy "athletes_select_authenticated"
  on public.athletes for select to authenticated
  using (true);

drop policy if exists "Enable read access for all users" on public.coaches;
create policy "coaches_select_authenticated"
  on public.coaches for select to authenticated
  using (true);

drop policy if exists "Enable insert for authenticated users only" on public.coaches;
create policy "coaches_insert_own"
  on public.coaches for insert to authenticated
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- 5. Finding D — coach_athlete_relationships
--
-- Was: INSERT with_check(true), so any authenticated user could fabricate a
-- coach/athlete pairing for anybody. SELECT was `true` to public, so every
-- pairing in the app was world-readable.
--
-- The accept flow (lib/api/notifications.ts) has the *athlete* update the request
-- and then insert the relationship, so the insert is scoped to the athlete and
-- gated on an accepted request actually existing for that exact pair.
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.coach_athlete_relationships;
create policy "car_select_own_side"
  on public.coach_athlete_relationships for select to authenticated
  using (
    (select auth.uid()) = athlete_id
    or (select auth.uid()) = coach_id
  );

drop policy if exists "Enable insert for authenticated users only" on public.coach_athlete_relationships;
create policy "car_insert_by_athlete_with_accepted_request"
  on public.coach_athlete_relationships for insert to authenticated
  with check (
    (select auth.uid()) = athlete_id
    and exists (
      select 1
      from public.coach_requests cr
      where cr.athlete_id = coach_athlete_relationships.athlete_id
        and cr.coach_id = coach_athlete_relationships.coach_id
        and cr.status = 'accepted'
    )
  );

-- No UPDATE or DELETE policy: nothing in the app does either, so both stay denied.

-- ---------------------------------------------------------------------------
-- 6. coach_requests — already correct, left alone
--
-- These four policies are the model the rest of this file follows: scoped to
-- auth.uid() on both sides, with a real status state machine in the with_check.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Findings A + B — conversations, conversation_members, messages
--
-- Previously: conversation_members SELECT and INSERT were both `true` to public,
-- so anyone could add themselves to any conversation and then read it. The
-- messages INSERT check compared cm.conversation_id to itself, so membership in
-- one conversation permitted posting to all of them. The conversations SELECT
-- check reduced to "is the caller in at least one conversation".
--
-- conversation_members SELECT is scoped to co-membership, NOT to
-- `user_id = auth.uid()`: user_conversations_view derives other_user_name and
-- other_user_avatar_url from the *other* member's row, and would return NULL for
-- every conversation under the narrower rule.
-- ---------------------------------------------------------------------------

drop policy if exists "Allow SELECT for members of a conversation" on public.conversations;
create policy "conversations_select_members"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

drop policy if exists "Allow UPDATE for members of conversation" on public.conversations;
create policy "conversations_update_members"
  on public.conversations for update to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

-- No client INSERT policy on conversations, and none on conversation_members
-- below. This is deliberate, and it is the one place where the obvious policy is
-- wrong.
--
-- The tempting rule is "you may always add *yourself* as a member", to let a
-- creator bootstrap a new conversation. But that is precisely the original
-- exploit: Mallory inserting (foreign_conversation_id, mallory) satisfies
-- `auth.uid() = user_id`. supabase/tests/rls_regression.sql fails on exactly that
-- if the clause is added back.
--
-- The two cases cannot be told apart, because `conversations` has no created_by
-- column to anchor "I made this" on. So both inserts stay denied to clients and
-- POST /conversations owns the flow under the service-role key, which is not
-- subject to RLS. Nothing in the app creates either row today, so this removes no
-- working behaviour.
drop policy if exists "Enable insert for authenticated users only" on public.conversations;

drop policy if exists "Enable read access for all users" on public.conversation_members;
create policy "cm_select_co_members"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- Denied to clients; see the note on conversations INSERT above.
drop policy if exists "Enable insert for authenticated users only" on public.conversation_members;

drop policy if exists "conversation_members_allow_same_conversation_update" on public.conversation_members;
create policy "cm_update_own_membership"
  on public.conversation_members for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- markAsRead (lib/api/conversations.ts) is the only client write here.
revoke update on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

drop policy if exists "Allow SELECT of conversations that user is a member of" on public.messages;
create policy "messages_select_members"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Allow INSERT for messages by user in conversation" on public.messages;
create policy "messages_insert_own_in_conversation"
  on public.messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.is_conversation_member(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- 8. Findings B + C + E — workouts, workout_exercises, sets
--
-- The scoped workout policies were dead twice over: the relationship EXISTS
-- clause compared r.athlete_id to itself, and a blanket
-- "Enable insert for authenticated users only" with_check(true) sat alongside
-- them. Permissive policies are OR'd, so the blanket one always won.
--
-- sets UPDATE was `auth.role() = 'authenticated'` -- any signed-in user could
-- rewrite any athlete's logged sets.
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.workouts;
drop policy if exists "Enable insert for authenticated users only" on public.workouts;
drop policy if exists "Allow INSERT for coaches of given athlete" on public.workouts;
drop policy if exists "Allow UPDATE for coaches of given athlete" on public.workouts;

create policy "workouts_select_participants"
  on public.workouts for select to authenticated
  using (
    coach_id = (select auth.uid())
    or (athlete_id is not null and athlete_id = (select auth.uid()))
  );

-- A template (athlete_id IS NULL) belongs to its coach. An assigned workout
-- additionally requires an active coach/athlete relationship.
create policy "workouts_insert_own_coach"
  on public.workouts for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and (
      athlete_id is null
      or athlete_id = (select auth.uid())
      or public.is_coach_of(athlete_id)
    )
  );

create policy "workouts_update_own_coach"
  on public.workouts for update to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and (
      athlete_id is null
      or athlete_id = (select auth.uid())
      or public.is_coach_of(athlete_id)
    )
  );

drop policy if exists "Enable read access for all users" on public.workout_exercises;
drop policy if exists "Enable insert for authenticated users only" on public.workout_exercises;

create policy "we_select_via_workout"
  on public.workout_exercises for select to authenticated
  using (public.can_access_workout(workout_id));

create policy "we_insert_via_workout"
  on public.workout_exercises for insert to authenticated
  with check (public.can_access_workout(workout_id));

drop policy if exists "Enable read access for all users" on public.sets;
drop policy if exists "Enable insert for authenticated users only" on public.sets;
drop policy if exists "Enable update for authenticated users only" on public.sets;

create policy "sets_select_via_workout_exercise"
  on public.sets for select to authenticated
  using (public.can_access_workout_exercise(workout_exercise_id));

create policy "sets_insert_via_workout_exercise"
  on public.sets for insert to authenticated
  with check (public.can_access_workout_exercise(workout_exercise_id));

create policy "sets_update_via_workout_exercise"
  on public.sets for update to authenticated
  using (public.can_access_workout_exercise(workout_exercise_id))
  with check (public.can_access_workout_exercise(workout_exercise_id));

-- Set logging (lib/api/workouts.ts updateSet) only ever writes these three.
-- The prescription columns belong to the coach and move to the API.
revoke update on public.sets from authenticated;
grant update (actual_load, actual_intensity, is_completed) on public.sets to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Finding H — exercises and templates
--
-- The exercise library is shared, so reads stay open to signed-in users. Writes
-- become owner-scoped: exercises.created_by and exercise_templates.created_by
-- both reference coaches.id, which equals users.id, which equals auth.uid().
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.exercises;
drop policy if exists "Enable insert for authenticated users only" on public.exercises;

create policy "exercises_select_authenticated"
  on public.exercises for select to authenticated
  using (true);

create policy "exercises_insert_own_coach"
  on public.exercises for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "Enable read access for all users" on public.exercise_templates;
drop policy if exists "Enable insert for authenticated users only" on public.exercise_templates;
drop policy if exists "Enable update for authenticated users only" on public.exercise_templates;

create policy "et_select_authenticated"
  on public.exercise_templates for select to authenticated
  using (true);

create policy "et_insert_own_coach"
  on public.exercise_templates for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "et_update_own_coach"
  on public.exercise_templates for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy if exists "Enable read access for all users" on public.exercise_default_set_templates;
drop policy if exists "Enable insert for authenticated users only" on public.exercise_default_set_templates;

create policy "edst_select_authenticated"
  on public.exercise_default_set_templates for select to authenticated
  using (true);

create policy "edst_insert_via_own_template"
  on public.exercise_default_set_templates for insert to authenticated
  with check (
    exists (
      select 1
      from public.exercise_templates t
      where t.id = exercise_default_set_templates.exercise_template_id
        and t.created_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 10. Reference data — read-only, signed-in users only
--
-- These were `true` to `public`. The data isn't sensitive, but there's no reason
-- to serve it to anon either, and create-profile.tsx reads them while
-- authenticated.
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users" on public.federations;
create policy "federations_select_authenticated"
  on public.federations for select to authenticated using (true);

drop policy if exists "Enable read access for all users" on public.divisions;
create policy "divisions_select_authenticated"
  on public.divisions for select to authenticated using (true);

drop policy if exists "Enable read access for all users" on public.weight_classes;
create policy "weight_classes_select_authenticated"
  on public.weight_classes for select to authenticated using (true);

commit;
