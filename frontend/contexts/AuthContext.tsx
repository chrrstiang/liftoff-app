import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { Session, User } from "@supabase/supabase-js";

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
  fetchProfile: (userId: string) => Promise<void>;
  checkProfileCompletion: (userId: string) => Promise<void>;
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

  /** Checks if the user's profile is complete */
  const checkProfileCompletion = useCallback(async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("users")
        .select("first_name, last_name, username, gender, date_of_birth")
        .eq("id", userId)
        .single();

      if (error) throw error;

      const isComplete = !!(
        profile?.first_name &&
        profile?.last_name &&
        profile?.username &&
        profile?.gender &&
        profile?.date_of_birth
      );

      if (!isComplete) {
        throw new Error("Missing profile fields");
      }
      setIsProfileComplete(isComplete);
    } catch (error) {
      console.error("Error checking profile completion:", error);
      setIsProfileComplete(false);
    }
  }, []);

  // fetches user profile metadata
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("users")
      .select(
        "first_name, last_name, username, email, gender, date_of_birth, is_athlete, is_coach, avatar_url"
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching profile:", error);
      return;
    }
    setProfile(data);
  }, []);

  // listens to real-time auth updates in case of session expire or manual action
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsLoading(true);

      setSession(session);
      setIsAuthenticated(!!session);
      setUser(session?.user || null);

      if (session?.user) {
        await fetchProfile(session.user.id);
        await checkProfileCompletion(session.user.id);
      } else {
        setProfile(null);
        setIsProfileComplete(false);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, checkProfileCompletion]);

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
