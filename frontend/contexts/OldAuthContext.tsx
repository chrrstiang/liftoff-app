import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "@/lib/supabase";
import * as Linking from "expo-linking";
import { Session } from "@supabase/supabase-js";

interface AuthContextType {
  isAuthenticated: boolean;
  checkAuthState: () => Promise<void>;
  isLoading: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getValidAccessToken: () => Promise<string | void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Keys for secure storage
export const ACCESS_TOKEN_KEY = "auth_access_token";
export const REFRESH_TOKEN_KEY = "auth_refresh_token";
export const EXPIRES_AT_KEY = "auth_expires_at";
export const ID_KEY = "auth_id_secure_key";
const LAST_PROCESSED_URL_KEY = "last_processed_url";

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
    const lastUrl = await SecureStore.getItemAsync(LAST_PROCESSED_URL_KEY);

    if (url === lastUrl) {
      console.log("🔄 Same URL as before, skipping...");
      return;
    }

    console.log("🔥 DEEP LINK HANDLER TRIGGERED");

    // Parse tokens from URL
    const { params } = QueryParams.getQueryParams(url);
    const { access_token, refresh_token, expires_at } = params;

    if (access_token && refresh_token && expires_at) {
      console.log("🔥 TOKENS FOUND, CREATING SESSION");

      // Create session
      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error && data.session) {
        console.log("🔥 SESSION CREATED, USER AUTHENTICATED");

        await storeSession(data.session);
        console.log("SESSION STORED!");

        setIsAuthenticated(true);

        await SecureStore.setItemAsync(LAST_PROCESSED_URL_KEY, url);
      }
    }
  };

  /** Stores necessary tokens and information of a session in SecureStore, for later reference.
   *
   * @param session The session to extract the information from.
   */
  const storeSession = async (session: Session) => {
    const { access_token, refresh_token, expires_at, user } = session;

    const id = user.id;

    await SecureStore.setItemAsync(ID_KEY, id);
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access_token);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh_token);
    await SecureStore.setItemAsync(EXPIRES_AT_KEY, expires_at!.toString());
  };

  const checkAuthState = async () => {
    console.log("Checking auth state...");
    try {
      // Get stored token and user data
      const access_token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      const refresh_token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      const expires_at = await SecureStore.getItemAsync(EXPIRES_AT_KEY);

      if (access_token && refresh_token && expires_at) {
        console.log(
          `👽 Found stored session info... access_token: ${access_token.substring(
            0,
            10
          )}..., refresh_token: ${refresh_token.substring(
            0,
            10
          )}..., expires_at: ${new Date(
            Number(expires_at) * 1000
          ).toISOString()}`
        );
        setIsAuthenticated(true);
      } else {
        console.log("🫢 Could not find stored session info...");
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error("Error checking auth state:", error);

      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      await SecureStore.deleteItemAsync(EXPIRES_AT_KEY);

      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  // uses the current refresh token to get a new access_token to pass to requests
  const getValidAccessToken = async (): Promise<string | void> => {
    try {
      // 1. Get the stored refresh token
      const refresh_token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

      if (!refresh_token) return;

      // 2. Use Supabase client to refresh session
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token,
      });

      if (error) {
        throw new Error(`Failed to refresh session:", ${error.message}`);
      }

      // 3. Save the new access token and refresh token
      if (data?.session) {
        await SecureStore.setItemAsync(
          ACCESS_TOKEN_KEY,
          data.session.access_token
        );
        await SecureStore.setItemAsync(
          REFRESH_TOKEN_KEY,
          data.session.refresh_token
        );
        return data.session.access_token;
      }
    } catch (err) {
      console.error(err);
      await logout();
    }
  };

  // sends a magic link to the given email for login/signup
  const sendMagicLink = async (email: string) => {
    clearAuthData();
    setIsAuthenticated(false);

    const redirect: string = makeRedirectUri();
    try {
      const response = await fetch(`${API_URL}/auth/magic-link/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, redirect }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Failed to sign up: ' + ${data.message}`);
      }

      console.log(data.message);
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  /** Calls the login endpoint, logging in the user and returning tokens/session data
   * in the response. If returned successfully, then the authenticated state is set to true.
   */
  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Failed to sign in: ' + ${data.message}`);
      }
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  /** Calls the logout endpoint, resetting the authenticated
   * state to false
   */
  const logout = async () => {
    console.log("Logging out");
    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error("Failed to logout: " + data.message);
      }

      clearAuthData();
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Logout error:", error);
      throw Error;
    }
  };

  const clearAuthData = async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(EXPIRES_AT_KEY);
    await SecureStore.deleteItemAsync(ID_KEY);
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
        getValidAccessToken,
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
