import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AuthFailure } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { Session, User } from "@supabase/supabase-js";
import { ApiError, api, describeApiError } from "@/lib/api/client";

/** Supabase remains the auth provider — signUp, signInWithPassword, signOut and
 * the session listener below are all still it, and correctly so. What moved is
 * every read of the `users` *table*, which now lives in RDS behind the API. */

interface UserProfile {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  gender: string;
  date_of_birth: string;
  is_athlete: boolean;
  is_coach: boolean;
  avatar_url?: string | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  /** `null` means **not yet known** — the profile request has not succeeded and
   * has not definitively 404'd.
   *
   * Three states rather than two, because two could not express the difference
   * between "this user has no profile" and "we could not ask". The gate in
   * `app/_layout.tsx` must hold rather than route while this is null; treating
   * unknown as incomplete is what sent returning users to the signup form. */
  isProfileComplete: boolean | null;
  /** Why the last profile load failed, when it failed for a reason other than a
   * 404. Null once a load succeeds. */
  profileError: string | null;
  /** Retries the profile load. Exposed so the gate can offer a retry rather than
   * stranding the user on an error screen. */
  reloadProfile: () => Promise<void>;
  /** The `userId` argument is now ignored — the API derives the caller from the
   * token. Kept in the signature so existing call sites still compile; it can go
   * once they stop passing it. */
  fetchProfile: (userId?: string) => Promise<void>;
  checkProfileCompletion: (userId?: string) => Promise<void>;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  setProfile: (profile: UserProfile | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  /** Starts as `null` — unknown — not `false`. See the type for why. */
  const [isProfileComplete, setIsProfileComplete] = useState<boolean | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    console.log("🔥 isAuthenticated state changed to:", isAuthenticated);
  }, [isAuthenticated]);

  /** Fetches the caller's own profile from the API.
   *
   * Both this and `checkProfileCompletion` used to read the `users` table directly
   * with the anon key, against a table whose SELECT policy is `using (true)` — so
   * any signed-in user could read any other user's row, email included. One
   * endpoint now serves both, and `is_profile_complete` is computed server-side.
   *
   * ⚠️ **A 404 is a normal state, not an error.** Between signing up and completing
   * the form there is no `users` row at all: the Supabase trigger that used to
   * create one does not exist in RDS, so the API owns creation. That 404 is exactly
   * the "send them to create-profile" signal the gate in `app/_layout.tsx` needs.
   *
   * Any *other* failure leaves `isProfileComplete` as **null** — not false.
   *
   * ⚠️ This used to say it left the value "alone", which was true and not enough:
   * the initial value was `false`, so on the **first** load — the common case, not
   * the rare one — leaving it alone meant leaving it false, and the gate routed a
   * returning user with a perfectly good profile to the create-profile form. From
   * there `POST /users/profile` *inserts* rather than upserts, so filling the form
   * in failed on the primary key and they were stuck on a screen they could
   * neither leave nor complete.
   *
   * Three states fix it properly: the failure is now representable, the gate holds
   * instead of guessing, and `profileError` gives the user something actionable
   * rather than a redirect.
   */
  const loadProfile = useCallback(async (): Promise<boolean> => {
    try {
      const data = await api.get<UserProfile & { is_profile_complete: boolean }>(
        "/users/me",
      );

      setProfile(data);
      setIsProfileComplete(data.is_profile_complete);
      setProfileError(null);
      return data.is_profile_complete;
    } catch (error) {
      // A 404 is a real answer: there is genuinely no profile row yet. That is
      // the one failure that legitimately means "incomplete".
      if (error instanceof ApiError && error.statusCode === 404) {
        setProfile(null);
        setIsProfileComplete(false);
        setProfileError(null);
        return false;
      }

      // Leave `isProfileComplete` as null: we do not know, and saying "false"
      // here is the bug this whole shape exists to prevent.
      const message = describeApiError(error, "Could not load your profile.");
      console.error("Error loading profile:", message);
      setProfileError(message);
      return false;
    }
  }, []);

  /** Kept as separate names because callers use them for different intents, but
   * both now hit the one endpoint — there is no reason to make two round trips
   * for data that arrives together. */
  const checkProfileCompletion = useCallback(
    async (_userId?: string) => {
      await loadProfile();
    },
    [loadProfile],
  );

  const fetchProfile = useCallback(
    async (_userId?: string) => {
      await loadProfile();
    },
    [loadProfile],
  );

  /** Retry, for the gate's error screen. Clears the previous error first so a
   * failed retry reads as a fresh failure rather than a stale one that never
   * went away. */
  const reloadProfile = useCallback(async () => {
    setProfileError(null);
    await loadProfile();
  }, [loadProfile]);

  // listens to real-time auth updates in case of session expire or manual action
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoading(true);

      setSession(session);
      setIsAuthenticated(!!session);
      setUser(session?.user || null);

      if (session?.user) {
        // ⚠️ **Never await a Supabase auth call inside this callback.** It is
        // dispatched while the auth client holds its internal lock, and
        // `loadProfile` reaches `supabase.auth.getSession()` (client.ts) to read
        // the bearer token — which waits for that same lock. The callback then
        // never reaches `setIsLoading(false)`, so the gate in app/_layout.tsx
        // spins forever.
        //
        // This deadlocked on *every returning user*: `INITIAL_SESSION` is emitted
        // from inside the lock while restoring a persisted session, so the app
        // hung on the splash spinner on every launch after the first. Signing up
        // or signing in fresh was unaffected, which is why it survived
        // development — you only hit it by reopening the app.
        //
        // Deferring to a macrotask lets the lock release first. The load is still
        // one call, not two: separate reads of the same row could observe
        // different states, and both had to finish before the gate could decide.
        setTimeout(() => {
          void loadProfile().finally(() => setIsLoading(false));
        }, 0);
        return;
      }

      setProfile(null);
      setIsProfileComplete(false);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  /** Signs up a new user with email and password */
  const signup = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    /* Rethrown as-is rather than wrapped in a new Error: the wrapper kept the
       message and dropped `code`, which is the only part the screens branch on.
       Without it every failure reads as "check your credentials". */
    if (error) {
      throw error;
    }

    /* An existing address is reported as a *success* when email confirmation is
       on — Supabase obfuscates it on purpose, and an empty `identities` array is
       the only tell. Left unhandled, the user is bounced to create-profile with
       no session and no explanation. */
    if (data.user && data.user.identities?.length === 0) {
      throw new AuthFailure("user_already_exists", "User already registered");
    }
  };

  /** Logs in the user with email and password */
  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      throw error;
    }
  };

  // logs out
  const logout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error("Failed to logout: " + error.message);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        login,
        logout,
        signup,
        isProfileComplete,
        fetchProfile,
        profileError,
        reloadProfile,
        session,
        checkProfileCompletion,
        user,
        profile,
        setProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
