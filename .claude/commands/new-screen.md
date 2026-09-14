---
description: Add an expo-router screen following the frontend's conventions
argument-hint: [screen name — what it should show]
---

Add a new frontend screen: **$ARGUMENTS**

Read `frontend/CLAUDE.md` first. Reference implementations, by what you need:

- `frontend/app/(app)/(tabs)/roster/roster.tsx` — list + search + segmented control, TanStack Query
- `frontend/app/(app)/conversations/[conversationId].tsx` — polling, optimistic mutation, image upload
- `frontend/app/(app)/workout/[workoutId].tsx` — nested data, sheet-based editing
- `frontend/app/(app)/create-profile.tsx` — a long form, and the one screen that still reads Supabase directly
- `frontend/app/(app)/(tabs)/_layout.tsx` — tab registration and role gating
- `frontend/app/_layout.tsx` — the auth gate

## Steps

1. **Pick the route group deliberately** and confirm if it's unclear:
   - `(auth)/` — reachable while signed out
   - `(app)/` — signed in, full-screen (no tab bar)
   - `(app)/(tabs)/` — signed in, appears in the tab bar (also needs a `Tabs.Screen` entry in `(tabs)/_layout.tsx`)

   Route filenames are lowercase (`create-profile.tsx`); components and contexts are PascalCase.

   **Role-gated tabs use `Tabs.Protected`** — the roster tab is coach-only, the program tab athlete-only. Follow that rather than conditionally rendering inside the screen.

2. **Check the auth gate.** `app/_layout.tsx` routes on `useSegments()` in an effect, behind an `isReady` memo. It sends a signed-out user to `(auth)/login`, a signed-in user with no profile row to `create-profile`, and everyone else to the tabs. If you're adding a new *top-level group*, add a case there or the screen will be redirected away the moment it mounts. A file inside an existing group needs no change.

   ⚠️ **Never `await` a Supabase auth method inside `onAuthStateChange`.** The callback runs while the client holds its own lock, so `getSession()` inside it deadlocks — which locked out every returning user until it was found. Defer to a macrotask.

3. **Build the screen.**
   - Style with NativeWind `className`. Avoid `StyleSheet.create` and inline `style` objects unless the prop can't accept a `className` (e.g. `contentContainerStyle`).
   - Compose from the existing primitives in `@/components/ui` (`Screen`, `Section`, `Button`, `Chip`, `Input`, `Field`, `Sheet`, `SheetRow`, `SheetInput`, `DataTable`, `EmptyState`, `Avatar`, `Text`, `Numeral`) before writing new ones.
   - Import via the `@/` alias only — no relative imports.
   - Double quotes. TS is `strict` here.
   - Icons from `lucide-react-native`.
   - Auth state via `useAuth()` from `@/contexts/AuthContext`.
   - **Every colour needs a `dark:` variant.** Nothing in CI can catch a dead Tailwind class, which is how the app shipped for months with light mode entirely unimplemented — see the verification section in `frontend/CLAUDE.md`.

4. **Data access goes through the API.** Add or reuse a function in `frontend/lib/api/*` — there are nine modules (`athlete`, `client`, `conversations`, `exercises`, `notifications`, `polling`, `roster`, `storage`, `workouts`) and they all go through `lib/api/client.ts`, which attaches the bearer token. Call it with **TanStack Query** (`useQuery` / `useMutation`), not a bare `useEffect` + `fetch`.

   Two deliberate exceptions, both already in place — match them, don't extend them:
   - **Supabase Storage** for the two image buckets (`lib/api/storage.ts`, and `ChatBubble.tsx` resolving public URLs).
   - **`create-profile.tsx` reads `federations` / `divisions` / `weight_classes` straight from Supabase** with the anon key. It is the one surviving direct table read. Do not copy this pattern for anything user-owned.

   **Realtime is gone** — it was replaced by polling when data moved to RDS. See `lib/api/polling.ts` (thread 5s, inbox 30s) if the screen needs to stay fresh.

5. **Handle loading and error states.** Screens use TanStack Query's `isLoading` / `isError` plus `ActivityIndicator` and `Alert.alert` — there is no toast system or error boundary.

6. **Verify**: `cd frontend && npm run lint && npm run type-check`

   There are no frontend tests, so lint + typecheck is the entire safety net — and neither sees a dead Tailwind class or a wrong colour. If the change is visually significant, offer to run the app rather than claiming it looks right.

## Constraints

- Don't add dependencies without asking. TanStack Query handles server state; `lib/api/*` is the client layer.
- Tailwind `content` globs only cover `./app/**` and `./components/**` — classes written elsewhere won't be generated.
- Shared UI belongs in `components/ui/`. Extract there when a second screen needs the same piece, not preemptively.
