import React, { createContext, useContext, useEffect, useState } from "react";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "@/lib/supabase";
import * as Linking from "expo-linking";
import { Session, User } from "@supabase/supabase-js";

interface AuthContextType {
  isAuthenticated: boolean;
  checkAuthState: () => Promise<void>;
  isLoading: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  isProfileComplete: boolean;
  checkProfileCompletion: (userId: string) => Promise<void>;
  session: Session | null;
  user: User | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

let lastProcessedUrl: string | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const url = Linking.useLinkingURL();

  // listens for deep link navigations
  useEffect(() => {
    if (url) {
      console.log("Link detected:", url);
      handleDeepLink(url);
    }
  }, [url]);

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
    });

    return () => subscription.unsubscribe();
  }, []);

  /** Handles the navigation from a deep link into the app.
   * Currently, the only deep link is from signup/sign-in.
   *
   * @param url The URL that was clicked, redirecting the user to the app.
   */
  const handleDeepLink = async (url: string) => {
    if (url === lastProcessedUrl) {
      console.log("🔄 Same URL as before, skipping...");
      return;
    }

    lastProcessedUrl = url;

    console.log("🔥 DEEP LINK HANDLER TRIGGERED");

    const { params } = QueryParams.getQueryParams(url);
    const { access_token, refresh_token } = params;

    const { data, error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error("Error setting session:", error);
    } else {
      console.log("Session set successfully");
      setIsAuthenticated(true);
      setSession(data.session);
    }
  };

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

  // sends a magic link to the given email for login/signup
  const sendMagicLink = async (email: string) => {
    const redirect: string = makeRedirectUri();

    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirect,
      },
    });

    if (error) {
      throw new Error("Failed to send magic link: " + error.message);
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
        sendMagicLink,
        login,
        logout,
        signup,
        isProfileComplete,
        session,
        checkProfileCompletion,
        user,
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
