import React, { createContext, useContext, useEffect, useState } from "react";
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
  checkAuthState: () => Promise<void>;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  isProfileComplete: boolean;
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

  useEffect(() => {
    if (session?.user) {
      checkProfileCompletion(session.user.id);
    }
  }, [session]);

  // listens to real-time auth updates in case of session expir or manual action
  useEffect(() => {
    checkAuthState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsAuthenticated(!!session);
      setUser(session?.user || null);

      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }

      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  /** Checks the current authentication state */
  const checkAuthState = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      setIsAuthenticated(!!session?.session);
      setSession(session?.session);
      setUser(session?.session?.user || null);
    } catch (error) {
      console.error("Error checking auth state:", error);
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  /** Checks if the user's profile is complete */
  const checkProfileCompletion = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("users")
        .select("first_name, last_name, username, gender, date_of_birth")
        .eq("id", userId)
        .single();

      if (error) throw error;

      const isComplete =
        profile?.first_name &&
        profile?.last_name &&
        profile?.username &&
        profile?.gender &&
        profile?.date_of_birth;

      if (!isComplete) {
        throw new Error("Missing profile fields");
      }
      console.log("Profile is now complete!");
      setIsProfileComplete(isComplete);
    } catch (error) {
      console.error("Error checking profile completion:", error);
      setIsProfileComplete(false);
    }
  };

  // fetches user profile metadata
  const fetchProfile = async (userId: string) => {
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
  };

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

    setIsAuthenticated(true);
  };

  // logs out
  const logout = async () => {
    console.log("🔥 LOGOUT TRIGGERED");
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error("Failed to logout: " + error.message);
    }

    setIsAuthenticated(false);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        checkAuthState,
        isLoading,
        login,
        logout,
        signup,
        isProfileComplete,
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
