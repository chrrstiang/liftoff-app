---
description: Add an expo-router screen following the frontend's conventions
argument-hint: [screen name — what it should show]
---

Add a new frontend screen: **$ARGUMENTS**

Read `frontend/CLAUDE.md` first. Reference implementations:

- `frontend/app/(app)/create-profile.tsx` — the only substantial screen (forms, Supabase reads, API write)
- `frontend/app/(app)/(tabs)/_layout.tsx` — tab registration
- `frontend/app/_layout.tsx` — the auth gate

## Steps

1. **Pick the route group deliberately** and confirm if it's unclear:
   - `(auth)/` — reachable while signed out
   - `(app)/` — signed in, full-screen (no tab bar)
   - `(app)/(tabs)/` — signed in, appears in the tab bar (also needs a `Tabs.Screen` entry in `(tabs)/_layout.tsx`)

   Route filenames are lowercase (`create-profile.tsx`); components and contexts are PascalCase.

2. **Check the auth gate.** `app/_layout.tsx:22` redirects on `useSegments()`. If you're adding a new *top-level group*, add a case there or the screen will be redirected away the moment it mounts. Adding a file inside an existing group needs no change.

3. **Build the screen.**
   - Style with NativeWind `className`. Avoid `StyleSheet.create` and inline `style` objects unless the prop can't accept a `className` (e.g. `contentContainerStyle`).
   - Import via the `@/` alias only — no relative imports.
   - Double quotes. TS is `strict` here.
   - Icons from `lucide-react-native`.
   - Auth state via `useAuth()` from `@/contexts/AuthContext`.

4. **Data access — choose the path explicitly** (see the root `CLAUDE.md`):
   - **Reads** currently go straight to Supabase: `supabase.from(...).select(...)` in a `useEffect`, following the federations/divisions pattern in `create-profile.tsx`. Remember the anon key means RLS is the only protection — confirm the table has a policy.
   - **Writes** go through the NestJS API with `Authorization: Bearer ${session?.access_token}`. There is no API client yet; if this is the second such call in the codebase, extract a small shared helper instead of copying the inline `fetch`.

5. **Handle loading and error states.** Existing screens use `useState` + `ActivityIndicator` + `Alert.alert` — there is no toast system or error boundary.

6. **Verify**: `cd frontend && npm run lint && npm run type-check`

   There are no frontend tests, so lint + typecheck is the entire safety net. If the change is visually significant, offer to run the app rather than claiming it looks right.

## Constraints

- Don't add dependencies (no state library, no React Query, no UI kit) without asking.
- Tailwind `content` globs only cover `./app/**` and `./components/**` — classes written elsewhere won't be generated.
- Shared UI belongs in `components/`, which currently holds only `Provider.tsx`. Extract there when a second screen needs the same piece, not preemptively.
