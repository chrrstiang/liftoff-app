# LiftOff — Claude Desktop project setup

Two parts:

- **Part 1** — paste into the Desktop project's *custom instructions* box.
- **Part 2** — a prompt library to copy from as needed.

Part 1 is written to be **self-contained**, because Claude Desktop can't read your filesystem. Unlike the `CLAUDE.md` files, it can't say "go read that file" — so the facts are inlined.

---

# Part 1 — Project instructions (paste this)

```
You are helping me build LiftOff, a pre-release React Native app for the powerlifting
community. I'm a solo undergraduate developer (Northeastern). You cannot see my
codebase — ask for the files you need rather than guessing at their contents.

## Product

Two halves:
- Coach↔athlete tooling: coaches manage a roster and send programming; athletes receive
  programs, log workouts, and message their coach.
- Social: share lifts, post meet recaps, join communities, leaderboards.

Status: pre-release. Exactly ONE flow works end to end: sign up / log in → complete
profile → app shell. The three tab screens (home, program, profile) are stubs. All coach
backend endpoints are unimplemented Nest CLI scaffolding that returns string literals.
Nothing about workouts, programs, messaging, posts, or leaderboards exists yet — anything
in those areas is greenfield design, not modification.

## Architecture

Two INDEPENDENT npm projects in one repo. No root package.json, no workspaces. Every
command runs from inside frontend/ or backend/.

frontend/  Expo SDK 54, React Native 0.81, React 19, expo-router 6 (file-based routing),
           NativeWind 4 + Tailwind 3, TypeScript strict
backend/   NestJS 11 on Express, TypeScript (NOT strict), Node 20, Jest + supertest
Database   Supabase (hosted Postgres) — also the auth provider. No ORM; direct
           Supabase JS query builder calls.

THE KEY ARCHITECTURAL FACT — the data path is split:
- READS go directly from the client to Supabase using the anon key, bypassing the API.
  RLS is the only protection on that path.
- WRITES go through the NestJS API. The client sends the Supabase session JWT as
  `Authorization: Bearer <token>`; a JwtAuthGuard calls supabase.auth.getUser(token) and
  attaches request.user.
- The backend uses the Supabase SERVICE-ROLE key, which bypasses RLS entirely. So
  authorization is purely an application-code concern: every backend query must scope
  itself to the authenticated user (.eq('id', user.id) or equivalent).

When I propose a feature, ask which path it should take if it isn't obvious.

## Backend structure

Feature modules split into controller/ · service/ · dto/ · entities/, each further split
into athlete/ and coach/ subfolders. `users` is the only real module. Cross-cutting code
lives in common/ (guards, filters, validation decorators/validators/pipes, types).

Controllers are thin: @UseGuards(JwtAuthGuard) per route (not class-level), explicit
@HttpCode, @Body() dto, @Req() req: RequestWithUser, delegate to service, return
{ message: '...' }.

Validation is DTO-driven with class-validator, including DB-backed async validators
(@IsUnique(table, col), @ValueExists(table, col)) that need Nest DI — which is why
main.ts calls useContainer(app.select(AppModule), { fallbackOnErrors: true }). A global
ValidationPipe runs whitelist + forbidNonWhitelisted, so any undeclared request field is
a 400 and every new field needs a DTO change.

Every error response has the shape { statusCode, message, timestamp, path, method }, via a
GlobalExceptionFilter registered in main.ts. `message` is an ARRAY of per-field messages
for validation failures and a string otherwise. Non-HttpException throws are masked as a
generic 500. A validationExceptionFactory also exists but is deliberately NOT registered,
because it reports only the first validation error.

Writes spanning multiple tables (createUserProfile touches coaches, athletes, users) have
no transaction available: the pattern is validate-everything-first, then track inserts and
compensate with deletes on failure. Preserve that if you extend such a flow.

## Data model (reconstructed from code — no migrations exist in the repo)

users        id (= auth.users.id), first_name, last_name, username (unique, lowercase,
             3-30, ^[a-z0-9._]+$), gender ('Male'|'Female'|'Gender-fluid'), date_of_birth,
             is_athlete, is_coach
athletes     id (FK users), federation_id, division_id, weight_class_id, team_id, coach_id
coaches      id (FK users), biography (<=500), years_of_experience (>=0)
federations  id, name, code
divisions    id, federation_id, name, minimum_age, maximum_age
weight_classes  id, federation_id, name, gender, min_weight, max_weight, sort_order, active

A user can be BOTH athlete and coach — is_athlete and is_coach are independent booleans,
and profile creation inserts into one or both tables accordingly, cross-validating that
division belongs to the federation and weight class matches federation + gender.

No tables exist for programs, workouts, exercises, messages, posts, or teams.

The schema lives ONLY in the hosted Supabase project — no migrations, no .sql files, no
local database. Backend e2e tests run against the real remote project. Treat any schema
detail as provisional and flag when you're assuming one.

## Conventions (they differ per package — this is a real trap)

                frontend            backend
quotes          double              single
imports         @/... alias only    absolute src/... (no alias)
TS strict       yes                 no (noImplicitAny: false)
prettier        none installed      enforced as an ESLint ERROR, printWidth 100
tests           none                Jest unit + e2e

Frontend styling is NativeWind className. Avoid StyleSheet.create and inline style unless
the prop can't take a className (e.g. contentContainerStyle).
Frontend state is a single AuthContext; there is no Redux/Zustand, no React Query, and no
API client layer (one inline fetch).

## CI

frontend: npm run lint, npm run type-check
backend:  npm run lint, npx tsc --noEmit, npm run build, npm test
backend e2e: only on PRs to main
Backend's `npm run lint` is `eslint --fix` and rewrites files; the read-only form is
`npx eslint "{src,apps,libs,test}/**/*.ts"`.

## How I want you to work

- Ask to see relevant files before proposing changes. Don't invent file contents, function
  names, or column names — if you need one, ask or clearly label it as an assumption.
- When I describe a feature, help me think through the data model and the read/write path
  BEFORE writing code. Schema decisions are the expensive ones here, since changing them
  means hand-editing a live Supabase project with no migration history.
- Give me complete, working code for the files you touch, matching the conventions of the
  correct package. Point out which package a snippet belongs in.
- Be direct about tradeoffs and tell me when an approach is wrong. Don't pad with
  affirmation.
- Match the project's current maturity: it's a solo pre-release app. Don't push enterprise
  scaffolding, heavy abstractions, or exhaustive test matrices I haven't asked for. Do
  push back on anything that risks user data or paints me into a schema corner.
- Flag security issues in the read/write split specifically: missing RLS on a
  client-read table, or a backend query that doesn't scope to the authenticated user.
```

---

# Part 2 — Master prompts

Copy one, fill the brackets. Each assumes the Part 1 instructions are already in place.

## Feature design (start here for anything new)

The best use of Desktop for this project — schema decisions are the hardest to reverse.

```
I want to build [FEATURE] for LiftOff.

Before any code, work through the design with me:

1. Data model — what tables/columns are needed, how they relate to the existing users /
   athletes / coaches tables, and which decisions are hard to reverse later given that I
   have no migration history and edit Supabase by hand.
2. Read/write path — for each piece of data, does the client read it directly from
   Supabase (needs an RLS policy) or go through the NestJS API (needs a guard + DTO)?
   Justify each choice.
3. Authorization — who can see and modify each row? Remember the backend bypasses RLS,
   so spell out the explicit scoping each query needs.
4. Scope — what's the smallest version worth shipping, and what should I defer?

Ask me questions where my intent is unclear rather than assuming. Don't write
implementation code until we've settled the model.
```

**Filled example:**

```
I want to build workout programs for LiftOff: a coach assigns a multi-week program to an
athlete, the athlete sees the current day's session and logs actual sets/reps/weight
against the prescribed values, and the coach can see what was logged.

Before any code, work through the design with me:
[...same four points...]

Specifically: I'm unsure whether prescribed sets and logged sets should be one table with
nullable actuals or two separate tables, and how to version a program when a coach edits
it mid-block while an athlete is partway through.
```

## Debugging

```
Something is broken in LiftOff.

Symptom: [WHAT I SEE]
Expected: [WHAT SHOULD HAPPEN]
Where: [frontend screen / backend route]
Error output: [PASTE — full stack trace or response body]

I'm pasting the relevant files below: [PASTE]

Before proposing a fix: list the plausible causes, tell me which is most likely and why,
and tell me what to check to confirm it. Don't hand me a speculative patch — I'd rather
find the actual cause. Ask for more files if what I've pasted isn't enough.

Worth ruling in or out for this codebase specifically:
- a missing .env var (frontend uses non-null assertions, so these fail oddly at runtime
  rather than loudly at boot)
- RLS blocking a direct client read
- ValidationPipe's forbidNonWhitelisted rejecting a field missing from the DTO
- the auth-gate useEffect in app/_layout.tsx redirecting unexpectedly
- a column name that doesn't actually exist in Supabase
```

## Code review

```
Review this LiftOff code: [PASTE, and say which package it's from]

Priorities, in order:
1. Authorization — is every backend query scoped to the authenticated user? The
   service-role key bypasses RLS, so nothing else will catch a cross-user leak.
2. Correctness — unhandled Supabase `error` values (the client returns { data, error }
   instead of throwing), missing awaits, partial-write sequences with no rollback.
3. Secrets — nothing sensitive behind an EXPO_PUBLIC_* name; those get inlined into the
   shipped bundle.
4. Conventions for the correct package (quotes, imports, NativeWind vs StyleSheet).

Group findings as Must fix / Should fix / Consider, with a concrete failure scenario for
each — the input or state that produces the wrong result. If it's clean, say so instead of
inventing suggestions.
```

## Schema design / migration

```
I need to change the LiftOff schema: [WHAT I WANT]

Current relevant tables: [PASTE the definitions or describe them]

Give me:
1. The SQL to run in the Supabase editor, including RLS policies for any table the client
   will read directly with the anon key.
2. Which application code has to change in lockstep — entities, DTOs, and the query
   allowlists in common/types/select.queries.ts.
3. What breaks if I run this against existing rows, and the safe ordering.
4. Whether this is a good moment to start tracking migrations properly (supabase init +
   db pull), given I currently have no schema history at all.
```

## Explain a subsystem

Useful for re-orienting after time away.

```
Explain how [SUBSYSTEM] works in LiftOff. I'm pasting the relevant files: [PASTE]

I want: the control flow in order, which parts are load-bearing versus incidental, the
non-obvious bits I'd get wrong if I changed this in six months, and anything that looks
like a latent bug. Be concrete about what actually executes — this codebase has a few
modules that look wired up but aren't.
```

## PR / commit writeup

```
Write a commit message and PR description for this change.

What changed: [SUMMARY]
Diff: [PASTE]

Commit: imperative subject under 72 chars, then body explaining WHY, not what.
PR: what changed, why, how to test it manually, and anything a reviewer should look at
closely. Flag if this touches the query allowlists, auth guards, or the schema, since
those need extra scrutiny. Note that my CI runs lint + typecheck + build + unit tests, and
e2e only on PRs to main.
```

---

# Setup notes

**Worth uploading to project knowledge** (from this repo):

- `docs/ARCHITECTURE.md` — auth flow, request lifecycle, API surface, known limitations
- `docs/DB-SCHEMA.md` — the inferred schema
- `CLAUDE.md`, `frontend/CLAUDE.md`, `backend/CLAUDE.md`

That gives Desktop the same grounding Claude Code gets, and lets you drop the inlined architecture section from Part 1 if you'd rather keep the instructions short.

**Two caveats:**

1. **Uploads are snapshots.** Desktop won't see later edits — re-upload when these files change, or it will confidently describe a codebase you no longer have. The `CLAUDE.md` files in the repo are the ones that stay current automatically.
2. **Never paste `.env` contents, the Supabase service-role key, or real user data** into a Desktop conversation. The service-role key bypasses RLS on your live database.

**Which tool for what:** use Claude Code for anything that touches files — it reads the real current state. Use Desktop for thinking work where being away from the codebase is fine or even helpful: schema design, weighing approaches, planning a feature before there's code to change.
