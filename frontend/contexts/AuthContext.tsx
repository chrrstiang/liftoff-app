import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "@/lib/supabase";
import * as Linking from "expo-linking";

interface AuthContextType {
  isAuthenticated: boolean;
  checkAuthState: () => Promise<void>;
  isLoading: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

let lastProcessedUrl: string | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const url = Linking.useLinkingURL();
  const API_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

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

    // Parse tokens from URL
    const { params } = QueryParams.getQueryParams(url);
    const { access_token, refresh_token } = params;

    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error("Error setting session:", error);
    } else {
      console.log("Session set successfully");
      setIsAuthenticated(true);
    }
  };

  const checkAuthState = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      setIsAuthenticated(!!session?.session);
    } catch (error) {
      console.error("Error checking auth state:", error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
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

  /** Calls the login endpoint, logging in the user and returning tokens/session data
   * in the response. If returned successfully, then the authenticated state is set to true.
   */
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

  /** Calls the logout endpoint, resetting the authenticated
   * state to false
   */
  const logout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error("Failed to logout: " + error.message);
    }

    setIsAuthenticated(false);
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
