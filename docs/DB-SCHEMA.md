# Database schema — VERIFIED

> **This document is now derived from the live schema, not from application code.**
>
> Captured 2026-08-03 from the `powerlifting-hub` Supabase project (`hqvnvnuuczqlpffebuui`, us-east-2) via `information_schema.columns`, `information_schema.table_constraints`, `pg_get_viewdef`, and `pg_policies`.
>
> Still not committed: the table DDL itself. `supabase db pull` needs Docker and a database password; run it to backfill `supabase/migrations/` with a real baseline. Until then this document is the record, and it is accurate for columns, types, nullability, defaults, foreign keys, view definitions, and policies — but it is a *transcription*, so a schema change made in the dashboard will silently make it stale. The `supabase db diff` drift check is what closes that gap.

## Tables

18 tables in `public`. `id` is `uuid` everywhere. Timestamps are `timestamptz`.

### Identity

`users` — the profile row. `id` defaults to `auth.uid()`, so a row inserts itself against the caller's identity.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid PK | NO | `auth.uid()` |
| `username` | text | YES | |
| `email` | text | **NO** | |
| `gender` | enum | YES | |
| `created_at` | timestamptz | YES | `now()` |
| `date_of_birth` | date | YES | |
| `first_name` | text | YES | |
| `last_name` | text | YES | |
| `is_athlete` | boolean | YES | |
| `is_coach` | boolean | YES | |
| `avatar_url` | text | YES | |

There is **no `role` column** and no `name` column. `role` was allowlisted in `VALID_TABLE_FIELDS.users`, which made `?data=users.role` a guaranteed 500 — removed. `email` is real and `NOT NULL`, but it was also removed from the allowlist: it is another user's PII on an otherwise public profile endpoint, and nothing requested it.

The five columns `checkProfileCompletion` gates on are `first_name`, `last_name`, `username`, `gender`, `date_of_birth`.

`athletes` — `id` is both PK and FK to `users.id`, so athlete id == user id == `auth.uid()`.

| Column | Type | Null | References |
|---|---|---|---|
| `id` | uuid PK | NO | `users.id` |
| `federation_id` | uuid | YES | `federations.id` |
| `division_id` | uuid | YES | `divisions.id` |
| `weight_class_id` | uuid | YES | `weight_classes.id` |
| `team_id` | uuid | YES | `teams.id` |

**There is no `coach_id` column.** It was in `VALID_ATHLETES_COLUMNS_QUERIES`, making `?data=coach_id` a guaranteed 500 — removed. Coach linkage lives in `coach_athlete_relationships`.

`coaches` — same identity pattern: `id` PK → `users.id`. Plus `biography` (text) and `years_of_experience` (integer), both nullable.

`teams` — exists, with only `id` (uuid PK, **no default**) and `created_at`. No name column, no rows written by anything. `athletes.team_id` points at it. A placeholder for unbuilt team features.

### Coach ↔ athlete

`coach_requests` — the invite. `id`, `created_at`, `updated_at` (nullable), `athlete_id` → `athletes.id`, `coach_id` → `coaches.id`, `status` (`coach_request_status`, default `'pending'`).

`coach_athlete_relationships` — the accepted link. `id`, `athlete_id` → `athletes.id`, `coach_id` → `coaches.id`, `status` (`coach_athlete_relationship_status`, NOT NULL, default `'pending'`), `created_at`.

### Messaging

`conversations` — `id`, `created_at`, `name` (nullable), `avatar_url` (nullable), `updated_at` (default `now()`).

**No `created_by` column.** This is load-bearing for authorization: there is no way for a policy to express "I created this conversation", which is why client inserts into `conversations` and `conversation_members` are denied outright and `POST /conversations` must own that flow under the service-role key. See the note in the RLS migration.

`conversation_members` — `id`, `created_at`, `conversation_id` → `conversations.id`, `user_id` → `users.id`, `last_read_at` (nullable).

`messages` — `id`, `conversation_id` → `conversations.id`, `user_id` → `users.id` (**nullable**), `created_at`, `content` (NOT NULL), `message_type` (enum, **NOT NULL, no default** — must be supplied on every insert), `media_url` (nullable).

### Programming

`workouts` — `id`, `athlete_id` → `athletes.id` (**nullable**), `coach_id` → `coaches.id` (**NOT NULL**), `created_at`, `date` (date, NOT NULL), `name` (text, NOT NULL), `notes`, `is_template` (boolean, **nullable, no default**).

The nullability pattern defines what a template is: a workout with `athlete_id IS NULL` belongs solely to its coach. And `is_template` having no default is why the template list is provably always empty — `createWorkout` never writes the column, so it is `NULL`, and `.eq("is_template", true)` never matches `NULL`.

`workout_exercises` — `id`, `workout_id` → `workouts.id`, `exercise_id` → `exercises.id`, `"order"` (integer, nullable — **a reserved word, needs quoting in raw SQL**), `notes`, `exercise_template_id` → `exercise_templates.id` (nullable), `created_at`, `display_name` (text, nullable).

`sets` — `id`, `workout_exercise_id` → `workout_exercises.id`, `created_at`, `set_number` (integer NOT NULL), `prescribed_reps` (**bigint** NOT NULL), `prescribed_intensity` (**text**), `suggested_load_min`/`suggested_load_max` (double precision), `actual_load` (double precision), `actual_intensity` (**double precision**), `is_completed` (boolean).

Note the asymmetry: `prescribed_intensity` is text but `actual_intensity` is double precision.

### Exercise library

`exercises` — `id`, `name` (NOT NULL), `created_by` → **`coaches.id`** (NOT NULL), `created_at`.

`exercise_templates` — `id`, `created_at`, `created_by` → **`coaches.id`** (NOT NULL), `name` (nullable), `exercise_id` → `exercises.id` (NOT NULL).

`exercise_default_set_templates` — `id`, `exercise_template_id` → `exercise_templates.id` (NOT NULL), `created_at`, `set_number` (NOT NULL), `prescribed_reps` (bigint NOT NULL), `prescribed_intensity` (text).

Both `created_by` columns reference `coaches`, not `users` — so only a user with a `coaches` row can author library content.

### Reference data

`federations` — `id`, `code` (NOT NULL), `name`.
`divisions` — `id`, `federation_id` → `federations.id` (NOT NULL), `name`, `minimum_age`, `maximum_age`.
`weight_classes` — `id`, `federation_id` → `federations.id` (NOT NULL), `gender` (enum), `name`, `min_weight`, `max_weight` (double precision), `sort_order` (smallint), `active` (boolean).

## Ownership chains

These are what the API's authorization checks traverse, now that the backend's service-role key bypasses RLS:

```
auth.uid() == users.id == athletes.id == coaches.id

sets → workout_exercises.workout_id → workouts.athlete_id | workouts.coach_id
messages → conversations, gated by conversation_members.user_id
coach_athlete_relationships → athletes.id | coaches.id
exercises / exercise_templates → created_by → coaches.id
```

## Views

Five views, all in `public`. **None reference `auth.uid()`** — every one is parameterized by explicit columns, so they return correct results from the backend's service-role client with an added `.eq()`. Read endpoints can be thin pass-throughs; do not rewrite the joins.

All five had `security_invoker` **off** (the default), meaning they executed with their owner's privileges and RLS on the base tables never ran. `20260804040000_harden_rls_policies.sql` turns it on for all of them. Before that migration, `select * from messages_with_sender` with no filter returned every message in the application to any holder of the anon key.

| View | Shape |
|---|---|
| `coach_athletes_view` | `coach_athlete_relationships` ⨝ `athletes` ⨝ `users`, left-joined to the three reference tables. Yields `coach_id`, `athlete_id`, name/username/avatar, `federation_code`, `division_name`, `weight_class_name`. |
| `messages_with_sender` | `messages` ⨝ `users`. Renames `user_id`→`sender_id` and `created_at`→`sent_at`, adds sender name and avatar. |
| `user_coach_requests_view` | `coach_requests` ⨝ `coaches` ⨝ `users`. Adds `coach_username`, `coach_avatar_url`. |
| `user_profiles_enriched_view` | `users` ⨝ `athletes`, left-joined to reference tables. Exposes `athlete_id` (**not `id`**) plus federation/division/weight-class ids and names. |
| `user_conversations_view` | `conversations` ⨝ `conversation_members`, with six correlated subqueries. See below. |

### `user_conversations_view` specifics

It emits **one row per `(conversation, member)` pair**, not one per conversation. `conversation_members` SELECT is scoped to co-membership rather than `user_id = auth.uid()` on purpose, because `other_user_name`, `other_user_avatar_url`, and `other_user_id` are derived from the *other* member's row and would be NULL under the narrower rule.

That makes the `.eq("user_id", userId)` filter in `lib/api/conversations.ts` **load-bearing, not cosmetic** — without it the inbox renders one duplicate entry per participant. Pinned by `supabase/tests/rls_regression.sql`.

`unread_count` is exactly:

```sql
count(*) from messages m
 where m.conversation_id = c.id
   and m.created_at > coalesce(cm.last_read_at, epoch)
   and m.user_id <> cm.user_id
```

Strict `>`, and your own messages are excluded. Any reimplementation that gets the boundary wrong presents as a permanently stuck unread badge.

`user_profiles_enriched_view` exposes `athlete_id` and has **no `id`** column, which is why the exclusion filter in `lib/api/athlete.ts` compared against `undefined` and never removed already-invited athletes.

## Row Level Security

`pg_policies` was captured before any changes; the original 39 policies and the analysis of what was wrong with them are in the plan and in the header comments of `supabase/migrations/20260804040000_harden_rls_policies.sql`. Summary of what that migration changes:

- `security_invoker = on` for all five views.
- RLS explicitly enabled on all 18 tables (idempotent — `pg_policies` cannot tell you whether row security is actually on, and a policy on a table with RLS disabled is inert).
- Three policies contained tautologies (`cm.conversation_id = cm.conversation_id`, `r.athlete_id = r.athlete_id`) that made their checks unconditionally true.
- Blanket `with_check (true)` policies were OR'd alongside scoped ones, defeating them. Removed.
- `conversation_members` was world-readable *and* world-insertable; `sets` UPDATE was `auth.role() = 'authenticated'`; `coach_athlete_relationships` INSERT was `with_check (true)`.
- Every remaining policy targets `authenticated` rather than `public`, so the anon key alone reads nothing.
- Authorization helpers (`is_conversation_member`, `is_coach_of`, `can_access_workout`, `can_access_workout_exercise`, `is_coach`) are `SECURITY DEFINER` with a pinned `search_path`. They must be — a policy on a table that subqueries the same table recurses, which is the trap the previous `conversation_members` UPDATE policy was in.
- Column privileges narrow client writes to the three columns the app actually writes: `users.avatar_url`, `sets.(actual_load, actual_intensity, is_completed)`, `conversation_members.last_read_at`.

`supabase/tests/rls_regression.sql` re-attempts each original attack and asserts the legitimate paths still work — 26 assertions, run inside a transaction that rolls back.

### Known remaining exposure

`users` SELECT is still `using (true)` for `authenticated`, so any signed-in user can read every user's `date_of_birth` and `email`. Row-level policies cannot fix this; it needs column privileges, which in turn need a `GET /users/me` endpoint so an owner can still read their own full row. Sequenced with the read migration.

## Enums

Four user-defined types are referenced. Names confirmed for two:

- `coach_request_status` — includes `'pending'`, `'accepted'`, `'rejected'`.
- `coach_athlete_relationship_status` — includes `'pending'`, `'active'`.
- `users.gender` / `weight_classes.gender` — reported as `USER-DEFINED`; the DTO's `Gender` enum is `'Male' | 'Female' | 'Gender-fluid'`.
- `messages.message_type` — reported as `USER-DEFINED`; NOT NULL with no default.

The exact type names and full value lists for the gender and message-type enums have not been captured. Get them with:

```sql
select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' group by t.typname;
```

## Making this fully authoritative

1. `supabase link --project-ref hqvnvnuuczqlpffebuui`, then `supabase db pull` (needs Docker and the database password) to commit a real DDL baseline.
2. Capture the enum definitions above.
3. Add `supabase db diff` to CI so dashboard edits fail the build instead of silently forking production.
