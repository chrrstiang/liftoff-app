# frontend — Expo / React Native

Run every command from `frontend/`. See the root `CLAUDE.md` for product context and the frontend↔backend data split.

## Stack

Expo SDK 54 · React Native 0.81 · React 19 · expo-router 6 · NativeWind 4 + Tailwind 3 · TypeScript (**strict**)

`app.json` enables `newArchEnabled`, `experiments.typedRoutes` (route strings are type-checked from generated `.expo/types`) and `experiments.reactCompiler`. Scheme is `frontend`.

## Commands

```bash
npm start          # Metro on :8081
npm run ios        # or android / web
npm run lint       # read-only
npm run lint:fix
npm run type-check # tsc --noEmit
```

There are **no tests and no formatter** in this package. CI runs lint + type-check only, so those two are your entire safety net — run them before claiming a change works.

## Routing

File-based via expo-router. Route files are lowercase; components and contexts are PascalCase.

```
app/
  _layout.tsx              root — wraps <Provider>, holds the auth gate
  (auth)/                  login.tsx, signup.tsx
  (app)/                   index.tsx, create-profile.tsx
  (app)/(tabs)/            home.tsx, program.tsx, profile.tsx   ← all stubs
```

**The auth gate is a single `useEffect` on `useSegments()` in `app/_layout.tsx:22`**, with three redirects:

1. not authenticated → `/(auth)/login`
2. authenticated but profile incomplete → `/(app)/create-profile`
3. authenticated, complete, still on create-profile → `/(app)/(tabs)/home`

Any new route group must be accounted for here or users will be bounced out of it. This is the first place to look when navigation misbehaves.

## Styling — NativeWind

Use `className` on React Native components. **Default to NativeWind and don't reach for `StyleSheet.create`** (`react-native/no-inline-styles` is a lint warning nudging the same direction).

There is one existing exception, and it's a principled one: `create-profile.tsx:661` defines a tiny `StyleSheet` for a `ScrollView`'s `contentContainerStyle`, which takes a style object rather than a `className`. That's the bar for adding another — a prop that genuinely can't accept `className`, not a preference.

Four files must stay in sync; breaking any one makes styles silently stop applying:

- `tailwind.config.js` — presets + `content` globs
- `global.css` — the `@tailwind` directives, imported at the top of `app/_layout.tsx`
- `babel.config.js` — `jsxImportSource: "nativewind"` + the `nativewind/babel` preset
- `nativewind-env.d.ts` — the type reference that makes `className` typecheck

`content` globs cover `./app`, `./components`, `./contexts`, and `./lib`. **If you add a new top-level directory containing styled components, add its glob too** — classes outside the globs are silently never generated, which looks like a broken component rather than a config problem.

## State

`contexts/AuthContext.tsx` is the **only** global store — no Redux, Zustand, or Jotai, and no server-state library (React Query / SWR). Screen state is plain `useState` (`create-profile.tsx` has ~15 of them).

Consume it with `useAuth()`, which exposes `{ isAuthenticated, isProfileComplete, isLoading, session, login, signup, logout, sendMagicLink, checkAuthState, checkProfileCompletion }`. It's mounted through `components/Provider.tsx` in the root layout.

`components/` currently holds only `Provider.tsx` — there is no component library yet.

## Talking to the backend

**There is no API client layer** — no `lib/api.ts`, no fetch wrapper, no generated types. The one backend call is an inline `fetch` at `app/(app)/create-profile.tsx:219`:

```ts
await fetch(`${API_URL}/users/profile`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  },
  body: JSON.stringify(payload),
});
```

When you add the *second* backend call, extract a small client (base URL + auth header + error shape) rather than copying this block. Everything else reads straight from Supabase via `lib/supabase.ts`.

## Conventions

- **Imports use the `@/*` alias exclusively** — `@/*` maps to `./*` (project root, so `@/lib/...`, not `@/src/...`). There is currently not a single relative import in `app/`, `components/`, `contexts/`, or `lib/`. Keep it that way.
- Double quotes. TS is `strict`, so no implicit `any`.
- Icons: `lucide-react-native`. Tabs/theming: `@react-navigation/*`.

## Environment

`frontend/.env` (gitignored, no template committed):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_KEY` — the **anon** key
- `EXPO_PUBLIC_API_URL` — backend origin, e.g. `http://localhost:8000`

Two traps:

1. `EXPO_PUBLIC_*` values are **inlined into the shipped bundle**. Never put a secret behind that prefix — in particular never the Supabase service-role key.
2. `lib/supabase.ts` reads these with non-null assertions (`process.env.X!`), so a missing var yields `undefined` and fails oddly at runtime instead of failing loudly at boot. If Supabase calls behave strangely, check `.env` first.
3. `localhost` in `EXPO_PUBLIC_API_URL` will not resolve from a physical device or emulator — use your machine's LAN IP.

The Supabase client is configured with AsyncStorage persistence, `autoRefreshToken`, `detectSessionInUrl: false`, and `flowType: 'pkce'`.

## Gotchas

- `assets/images/` is still the default create-expo-app artwork, not real branding.
- The create-expo-app `reset-project` script has been removed (it pointed at a missing file and would have deleted `app/`). Don't reintroduce it.
- `README.md` in this directory is unmodified boilerplate — ignore it.
