import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setStoredToken, getStoredToken } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True while waiting on a sleeping free-tier API. */
  waking: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    displayName: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    setWaking(true);
    api
      .me()
      .then(setUser)
      .catch((err: unknown) => {
        // Only log out on real auth failures — not when Render is asleep / network blip.
        if (err instanceof ApiError && err.status === 401) {
          setStoredToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        setWaking(false);
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setWaking(true);
    try {
      const result = await api.login({ email, password });
      setStoredToken(result.token);
      setUser(result.user);
    } finally {
      setWaking(false);
    }
  }, []);

  const register = useCallback(
    async (email: string, displayName: string, password: string) => {
      setWaking(true);
      try {
        const result = await api.register({ email, displayName, password });
        setStoredToken(result.token);
        setUser(result.user);
      } finally {
        setWaking(false);
      }
    },
    []
  );

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, waking, login, register, logout }),
    [user, loading, waking, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
