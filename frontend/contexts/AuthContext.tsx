import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";

type User = {
  id: string;
  email: string;
  name: string;
  token: string;
};

type AuthContextData = {
  user: Omit<User, "token"> | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  signout: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

// SecureStore keys
const USER_KEY = "user_data";
const TOKEN_KEY = "auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Omit<User, "token"> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check if user is logged in on app start
  useEffect(() => {
    async function loadStoredData() {
      try {
        const userData = await SecureStore.getItemAsync(USER_KEY);
        if (userData) {
          const parsedUser = JSON.parse(userData);
          setUser(parsedUser);
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Failed to load user data", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadStoredData();
  }, []);

  const storeAuthData = async (userData: User) => {
    const { token, ...userWithoutToken } = userData;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userWithoutToken));
    setUser(userWithoutToken);
  };

  const clearAuthData = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
    setIsAuthenticated(false);
  };

  const login = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      const response = await fetch("YOUR_API_URL/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Login failed");
      }

      const userData = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        token: data.token,
      };

      await storeAuthData(userData);
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert(
        "Login Error",
        error instanceof Error ? error.message : "Failed to login"
      );
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, name: string) => {
    try {
      setIsLoading(true);
      const response = await fetch("YOUR_API_URL/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Signup failed");
      }

      const userData = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        token: data.token,
      };

      await storeAuthData(userData);
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Signup error:", error);
      Alert.alert(
        "Signup Error",
        error instanceof Error ? error.message : "Failed to sign up"
      );
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const signout = async () => {
    try {
      setIsLoading(true);
      await clearAuthData();
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Signout error:", error);
      Alert.alert("Error", "Failed to sign out");
    } finally {
      setIsLoading(false);
    }
  };

  const getAuthToken = async (): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch (error) {
      console.error("Failed to get auth token", error);
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        signup,
        signout,
        getAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
