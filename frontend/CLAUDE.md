# frontend — Expo / React Native

Run every command from `frontend/`. See the root `CLAUDE.md` for product context and the frontend↔backend data split.

## Stack

Expo SDK 54 · React Native 0.81 · React 19 · expo-router 6 · NativeWind 4 + Tailwind 3 · TypeScript (**strict**) · TanStack Query 5

`app.json` enables `newArchEnabled`. `experiments.typedRoutes` and `reactCompiler` are **off** — they were dropped in the `cg_branch` merge and re-enabling typedRoutes may surface new errors in existing route strings, so turn it on deliberately rather than in passing. There is no `scheme`: magic-link auth was removed, nothing calls `makeRedirectUri`, and adding one back means updating the Supabase redirect allowlist.

## Commands

```bash
npm start          # Metro on :8081
npm run ios        # or android / web
npm run lint       # read-only
npm run lint:fix
npm run type-check # tsc --noEmit
```

There are **no tests and no formatter** in this package. CI runs lint + type-check only, so those two are your entire safety net — plus the dead-class check below, which neither of them can do.

## Routing

File-based via expo-router. Route files are lowercase; components and contexts are PascalCase.

```
app/
  _layout.tsx                          root — fonts, splash, <Provider>, auth gate
  (auth)/                              login.tsx, signup.tsx
  (app)/                               index.tsx, create-profile.tsx
  (app)/(tabs)/                        home.tsx, profile.tsx
  (app)/(tabs)/conversations/          conversations.tsx      (Messages tab)
  (app)/(tabs)/program/[athleteId].tsx (Program tab, athletes)
  (app)/(tabs)/roster/roster.tsx       (Roster tab, coaches)
  (app)/conversations/[conversationId].tsx
  (app)/roster/[athleteId].tsx
  (app)/workout/[workoutId].tsx
```

**The auth gate is in `app/_layout.tsx`** — an `isReady` memo plus a `useEffect` on `useSegments()`, with three redirects: unauthenticated → login, authenticated but incomplete → create-profile, complete → tabs. The `isReady` gate holds a spinner until the user is in the *right* place, which stops a frame of the wrong screen flashing. Any new route group must be accounted for here or users get bounced out of it.

**Tabs are role-gated** in `(tabs)/_layout.tsx` via `Tabs.Protected`: Program shows for `profile.is_athlete`, Roster for `profile.is_coach`. Home, Messages and Profile are always present. Program's `href` points at the signed-in user's own id.

## Design system

**Build screens out of `components/ui`, and do not write raw colour classes in a screen.**

`theme/tokens.js` is the single source of truth for colour, type and radii. It's consumed by `tailwind.config.js` (CommonJS `require`) and by runtime TS via `theme/useTheme.ts` for values that can't be classes — `placeholderTextColor`, lucide `color`, `ActivityIndicator`, native views like `SegmentedControl` and `DateTimePicker`, and the React Navigation theme in `theme/navigation.ts`.

Light/dark pairing (`bg-canvas dark:bg-canvas-dark`) lives **inside** the ui components. That's what stops the two themes drifting, which is how the app previously ended up with `bg-violet-500 dark:bg-red-700` on one button. A screen writing its own `dark:` colour variant is a smell.

Primitives: `Screen` `Button` `Input` `Field` `Section` `SheetRow` `SheetInput` `Sheet`/`SelectSheet` `Chip` `Text` `Numeral` `DataTable` `Avatar` `EmptyState`.

Direction — **Uber's structure, Claude's surfaces**:

- Warm cream canvas (`#FAF9F5`) and warm dark (`#181715`), never pure white or blue-black.
- **Coral owns every primary action**; at most one `primary` Button per screen.
- **Selection is monochrome** — an ink fill — so it can never be confused with an action. Same for markers: unread counts, "Today" badges and chosen-exercise pills are all ink, not coral.
- Form sections are **ruled sheets, not floating cards**: `Section` + `SheetRow`/`SheetInput`, label left and value right-aligned. This is the "meet sheet", after powerlifting's own lifter sheet.
- `DataTable` is the attempt sheet — set/rep/load columns declared once and shared by header and rows. Use it for any numeric grid; don't hand-roll column widths, which is how the header and body previously drifted apart.
- Fraunces for titles and **all numerals** (`tabular-nums`); Inter for every label, button and body string.
- **No shadows.** Elevation is surface contrast plus hairlines.
- Plate colours (`plate-25`, `plate-20`, …) are **reserved for weight data and currently unused**. Mapping a load to a plate denomination means deriving what's on the bar, which needs bar weight (20kg vs 15kg) and federation-specific collar rules. Don't spend them on decoration; wire them up when that rule exists.

On React Native a weight utility does not select a face, so use the family classes (`font-inter-semibold`, `font-fraunces`) — Tailwind's `font-semibold` silently does nothing. In practice use `Text`'s `variant`.

## Styling — NativeWind

Use `className` on React Native components. **Default to NativeWind and don't reach for `StyleSheet.create`.**

The sanctioned exception is a prop that genuinely cannot take a `className`. Current cases: `contentContainerStyle` (`Screen`, `roster`, `conversations`), `fontVariant: ["tabular-nums"]` (`Numeral`, `SheetInput`), dynamic column widths (`DataTable`), native `SegmentedControl` font styles, and `expo-image`/`RNImage` sizing. That's the bar.

Interaction variants: use **`active:`** on a `Pressable`. NativeWind registers only `native`, `placeholder`, `selection` and `web`; the engine handles `active` via `onPressIn`, which `TouchableOpacity` doesn't surface. There is no `pressed:` variant — the pre-redesign buttons used it and therefore had no press feedback at all.

Four files must stay in sync; breaking any one makes styles silently stop applying:

- `tailwind.config.js` — presets + `content` globs
- `global.css` — the `@tailwind` directives, imported at the top of `app/_layout.tsx`
- `babel.config.js` — `jsxImportSource: "nativewind"` + the `nativewind/babel` preset
- `nativewind-env.d.ts` — the type reference that makes `className` typecheck

`content` globs cover `./app`, `./components`, `./contexts`, `./lib` and `./theme`. **A new top-level directory with styled components needs its glob too** — classes outside the globs are never generated, which looks like a broken component rather than a config problem.

### Verifying classes actually exist

Neither `lint` nor `type-check` can see a class that generates no CSS; that is exactly how light mode stayed unimplemented for months. Compile and diff:

```bash
npx tailwindcss -i ./global.css -o /tmp/out.css --config ./tailwind.config.js
```

Then check every `className` token against the output. As of the redesign this is **137 classes used, 0 dead**.

⚠️ **This check has one blind spot: it runs the *web* compiler.** `max-h-[70vh]` compiles happily and passes, but `vh` is not a unit React Native understands and is silently ignored on device. For viewport-relative sizing use `useWindowDimensions` — `SelectSheet`, `ExerciseSelector` and the workout sheet all do.

## State

Two stores, and they don't overlap:

- **`contexts/AuthContext.tsx`** — session and profile. `useAuth()` exposes `{ isAuthenticated, isLoading, isProfileComplete, session, user, profile, setProfile, login, signup, logout, fetchProfile, checkProfileCompletion }`.
- **TanStack Query** — all server state, keyed by resource. Several mutations are optimistic with rollback (`addExerciseMutation`, `createWorkoutMutation`, `sendInviteMutation`, `requestMutation`, `sendMessageMutation`). Preserve the `onMutate`/`onError` pairing when touching them.

No Redux, Zustand or Jotai. Screen state is plain `useState`.

`components/Provider.tsx` composes `SafeAreaProvider` → `QueryClientProvider` → `AuthProvider` → navigation `ThemeProvider` → `KeyboardProvider`. `SafeAreaProvider` must stay outermost: `Screen` renders a `SafeAreaView` and silently gets zero insets without it.

## Talking to the backend

**Almost nothing goes through the API.** Reads *and* writes go straight to Supabase via `lib/api/*` (`athlete`, `conversations`, `exercises`, `notifications`, `roster`, `storage`, `workouts`) — including 13 direct `insert`/`update` calls.

The **only** backend call in the entire frontend is `POST /users/profile` from `app/(app)/create-profile.tsx`. So profile creation is the one flow that needs the API running; everything else works with the backend stopped.

⚠️ **Those direct writes run with the anon key, so RLS is the only thing authorising them.** Nothing client-side stops a user inserting a `coach_athlete` row for someone else's athlete or updating another user's set.

**All backend calls go through `lib/api/client.ts`.** Do not hand-roll a `fetch`:

```ts
import { api, describeApiError } from "@/lib/api/client";

await api.post("/users/profile", payload);
```

It owns three things that were each a bug waiting to happen:

- **Base URL, with a named failure.** A missing `EXPO_PUBLIC_API_URL` used to become the literal string `"undefined"` in the URL, which React Native reports as `Network request failed` — indistinguishable from a real connectivity problem. It now throws `ApiConfigError` naming the variable.
- **The auth header**, read from the live Supabase session (`getSession()`), so a caller cannot send a stale token. Pass `accessToken` to override.
- **The error envelope.** `ApiError.messages` is always an array, whether the server sent a string (thrown exception) or an array (`ValidationPipe`). The old inline fetch read `errorData.error` — a field the API has never sent — so every validation failure showed a generic fallback and discarded the per-field messages. `describeApiError(error, fallback)` gives you one string for an `Alert`, and handles non-JSON 502s, which matters once this sits behind an ALB.

## Conventions

- **Imports use the `@/*` alias** from `app/`, `components/` and `contexts/` — `@/*` maps to `./*` (project root, so `@/lib/...`). Siblings inside `components/ui` import each other relatively, so the barrel can't cycle through itself.
- **Types live in `types/`, split per resource** (`coach`, `conversation`, `reference`, `user`, `workout`) behind a barrel — import from `@/types`, never a specific file. They were one `types/types.ts`, which every migration slice would have had to edit, making a merge conflict guaranteed on each. `Profile` / `Federation` / `Division` / `WeightClass` moved here out of `create-profile.tsx`.
  - Watch nullability: reference-data `name` columns are nullable, and `id` columns are **uuid strings**, not numbers. The old local interfaces declared `Federation.id: number` and `WeightClass.sort_order: boolean`; both were wrong and typechecked only because Supabase's `data` is untyped.
- Double quotes. TS is `strict`, so no implicit `any`.
- Icons: `lucide-react-native` throughout. `@expo/vector-icons` is installed but no longer used in app code — don't reintroduce it.
- Fonts load in `app/_layout.tsx` via `useFonts` behind `SplashScreen.preventAutoHideAsync()`. **A new weight must be added both to that `useFonts` call and to `fontFamily` in `theme/tokens.js`** — a family name with no loaded face falls back to system silently.
- `expo-image` is not a NativeWind component. Use `Avatar`, or pass `style`. A `className` on it only works if `cssInterop` was registered by some other module that happens to be loaded.

## Environment

`frontend/.env` (gitignored; copy `.env.example`):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_KEY` — the **anon** key
- `EXPO_PUBLIC_API_URL` — backend origin

Three traps:

1. `EXPO_PUBLIC_*` values are **inlined at bundle time**. Never put a secret behind that prefix, and restart Metro with `--clear` after editing — a running server won't pick up changes.
2. **`localhost` will not resolve from a physical device.** Use the machine's LAN IP. This is the most common cause of "Network request failed" on create-profile.
3. `lib/supabase.ts` throws a named error when its vars are missing, and `lib/api/client.ts` now does the same for `EXPO_PUBLIC_API_URL` (`ApiConfigError`). Before that, a missing value became the literal string `"undefined"` in the URL and surfaced as `Network request failed` — which reads as a connectivity problem rather than a config one.

## Gotchas

- **`web.output` must stay `"single"`.** Under `"static"` Expo prerenders the tree and `AuthContext` → Supabase → storage touches `window`, crashing the dev server.
- **`DateTimePicker` is a native view and cannot be themed.** `themeVariant` takes only `"dark" | "light"`, and it's a config plugin, so replacing it needs a native rebuild. It's the one control that won't match the palette; it's wrapped in `Sheet` so at least the chrome does.
- **Native module versions must match what Expo Go ships.** `react-native-svg` was undeclared (pulled in transitively by `lucide-react-native`) and resolved three minors ahead of Expo Go's build, which bundled fine and then errored on open. `expo install --check` can't see a package the manifest doesn't list. Run `npx expo install --fix` when anything native misbehaves.
- `assets/images/` is still create-expo-app artwork. There is no logo asset, so the wordmark is set in Fraunces type.
- `README.md` in this directory is unmodified boilerplate — ignore it.

## Known issues

- **Date of birth has no unset state.** It initialises to `new Date()`, so the row always shows today and `handleSubmit`'s `!dateOfBirth` check can never fail. A user can submit today as their birth date.
- **`onCreateWorkout` takes an `isTemplate` flag that is silently dropped.** Both call sites in `program/[athleteId].tsx` pass one, but the parent handler declares three parameters and TypeScript allows the narrower signature. `createWorkout()` has no such field either, so template-derived and custom workouts persist identically.
- `isLoading` in create-profile is set and cleared synchronously inside the fetch effects, so it's effectively always `false` during those reads. Don't build a spinner on it.
- `years_of_experience` is `parseInt("")` → `NaN` → serialises to `null`. It passes because the DTO field is optional.
