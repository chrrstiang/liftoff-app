import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
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
  isProfileComplete: boolean;
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
  const [isProfileComplete, setIsProfileComplete] = useState(false);
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
   * Any *other* failure deliberately leaves `isProfileComplete` alone rather than
   * setting it false. The old version treated every thrown error as "incomplete",
   * so a dropped connection was indistinguishable from a missing profile and
   * bounced the user out of their session mid-use.
   */
  const loadProfile = useCallback(async (): Promise<boolean> => {
    try {
      const data = await api.get<UserProfile & { is_profile_complete: boolean }>(
        "/users/me",
      );

      setProfile(data);
      setIsProfileComplete(data.is_profile_complete);
      return data.is_profile_complete;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        setProfile(null);
        setIsProfileComplete(false);
        return false;
      }

      console.error("Error loading profile:", describeApiError(error));
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
    const { error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    if (error) {
      throw new Error("Failed to sign up: " + error.message);
    }
  };

  /** Logs in the user with email and password */
  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      throw new Error("Failed to login user: " + error.message);
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
