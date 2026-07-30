# Database schema — INFERRED, NOT AUTHORITATIVE

> ⚠️ **This document is a reconstruction, not a source of truth.**
>
> The real schema exists **only in the hosted Supabase project**. This repo contains no migrations, no `.sql` files, and no Supabase CLI directory. Everything below was derived from:
>
> - `backend/src/users/entities/` — `UserData.ts`, `AthleteData.ts`, `CoachData.ts`
> - `backend/src/users/dto/` — validation rules
> - `backend/src/common/types/select.queries.ts` — query allowlists
> - every `.from(...).select(...)` call in the backend and frontend
>
> Consequences: columns the code never touches are **missing here**; types are inferred from usage; and nullability/defaults/indexes/RLS policies are largely unknown. A column appearing below is evidence that *code references it*, not proof it exists.
>
> **Before relying on this, verify against Supabase.** See "Making this authoritative" at the bottom.

---

## `users`

Extends Supabase's `auth.users`. The row is created by Supabase Auth on signup with the profile fields empty, then **updated** (never inserted) by `POST /users/profile`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | Same value as `auth.users.id` |
| `first_name` | text | Required at profile completion |
| `last_name` | text | Required |
| `username` | text, unique | Lowercase, 3–30 chars, `^[a-z0-9._]+$`. Uniqueness enforced in-app by `@IsUnique('users','username')` — unclear whether a DB constraint also exists |
| `gender` | text/enum | `'Male'` \| `'Female'` \| `'Gender-fluid'` (`Gender` enum in `create-user.dto.ts`) |
| `date_of_birth` | date | ISO date string |
| `is_athlete` | boolean | Independent of `is_coach` — both may be true |
| `is_coach` | boolean | |
| `email` | text | ⚠️ Allowlisted in `VALID_TABLE_FIELDS`, never written by app code — presumably mirrored from `auth.users`. Opt-in via `?data=` only |
| `role` | text | ⚠️ Allowlisted, **never written**. Likely vestigial, superseded by `is_athlete` / `is_coach`. Removed from the default profile query so it can't break it; an explicit `?data=users.role` may still error |

There is **no `name` column** in the app's model. `select.queries.ts` used to select one, which would have broken the default profile query; it now uses `first_name` and `last_name`.

The five columns checked by `checkProfileCompletion` — `first_name`, `last_name`, `username`, `gender`, `date_of_birth` — are what gate app access.

## `athletes`

One row per user with `is_athlete = true`. Inserted by `UsersService.createUserProfile`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | FK → `users.id` |
| `federation_id` | uuid, nullable | FK → `federations.id` |
| `division_id` | uuid, nullable | FK → `divisions.id`. App validates it belongs to `federation_id` |
| `weight_class_id` | uuid, nullable | FK → `weight_classes.id`. App validates it matches `federation_id` **and** `gender` |
| `team_id` | uuid, nullable | ⚠️ In the query allowlist but absent from `AthleteData` and never written. Presumably for the unbuilt teams/communities feature |
| `coach_id` | uuid, nullable | ⚠️ Same — allowlisted, never written. For the unbuilt coach-roster feature |
| `user_id` | uuid | ⚠️ **Deliberately excluded** from `VALID_ATHLETES_COLUMNS_QUERIES` because it maps to `auth.uid()`. Do not add it to the allowlist |

Note `AthleteData` (the write shape) has only four fields, while the read allowlist has six — the table is wider than the entity.

## `coaches`

One row per user with `is_coach = true`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | FK → `users.id` |
| `biography` | text, nullable | Max 500 chars (`@Length(0, 500)`) |
| `years_of_experience` | integer, nullable | `@Min(0)` |

## `federations`

Reference data — powerlifting federations (USAPL, IPF, …). Read directly by the client to populate dropdowns. Seeded manually in Supabase; nothing in this repo creates rows.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `name` | text | Display name |
| `code` | text | Short code. A `@ValueExists('federations','code')` validator exists (`validate-federation.ts`) |

## `divisions`

Reference data, scoped to a federation (age-based divisions).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `federation_id` | uuid | FK → `federations.id` |
| `name` | text | |
| `minimum_age` | integer | |
| `maximum_age` | integer | |

## `weight_classes`

Reference data, scoped to a federation **and** gender.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `federation_id` | uuid | FK → `federations.id` |
| `name` | text | |
| `gender` | text/enum | Matched against the user's `gender` |
| `min_weight` | numeric | |
| `max_weight` | numeric | |
| `sort_order` | integer | Client orders dropdowns by this |
| `active` | boolean | Retired weight classes presumably set false. Nothing in the app filters on it yet |

---

## Relationships

```
auth.users
   │ 1:1
users ─────┬──── 1:0..1 ──── athletes ──┬── FK → federations
           │                            ├── FK → divisions      (must belong to federation)
           │                            ├── FK → weight_classes (must match federation + gender)
           │                            ├── FK → coaches?  (coach_id, unused)
           │                            └── FK → teams?    (team_id, table not referenced anywhere)
           └──── 1:0..1 ──── coaches

federations ──< divisions
federations ──< weight_classes
```

A user may have **both** an `athletes` and a `coaches` row.

There is no `teams` table referenced anywhere in the code — only the dangling `athletes.team_id` column.

## Not yet modeled

Core product features from the README have no schema at all: workout programs, logged workouts, exercises/lifts, coach↔athlete messaging, posts/meet recaps, communities, leaderboards. Designing these is greenfield.

## RLS

Unknown from this repo, and it matters more than usual:

- The **frontend** uses the anon key and reads `users`, `federations`, `divisions`, and `weight_classes` directly. RLS is the only thing protecting those reads.
- The **backend** uses the service-role key and **bypasses RLS entirely**, so every backend query must scope itself in application code.

Before adding a client-side read of a new table, confirm its RLS policy.

---

## Making this authoritative

Two options, in order of value:

**Add migrations to the repo.** `supabase init` + `supabase db pull` captures the live schema as versioned SQL, making this document generated rather than guessed, and giving e2e tests something local to run against. This is the highest-leverage infrastructure change available in this project.

**Or paste the current definitions below** as a stopgap — from the Supabase dashboard, or:

```bash
supabase db dump --schema public > docs/schema.sql
```

<!-- ── PASTE REAL SCHEMA BELOW ──────────────────────────────────────────
Replace this block with actual table definitions. Once real, delete the
"INFERRED" banner at the top of this file and the doubtful-column warnings
above (users.email, users.role, athletes.team_id, athletes.coach_id).
──────────────────────────────────────────────────────────────────────── -->
