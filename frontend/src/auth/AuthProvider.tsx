import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { decodeJwt, isExpired, type JwtPayload } from "./jwt";

export type Role = "superadmin" | "owner" | "receiver_user" | "cashier_user";

export interface AuthUser {
  id: number;
  shopId: number | null;
  role: Role;
  username: string;
  fullName: string;
  phone: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  isReady: boolean;
}

const TOKEN_KEY = "barstock.token";
const USER_KEY = "barstock.user";

const Ctx = createContext<AuthContextValue | undefined>(undefined);

function readSession(): { token: string; user: AuthUser; payload: JwtPayload } | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const userRaw = sessionStorage.getItem(USER_KEY);
  if (!token || !userRaw) return null;
  const payload = decodeJwt(token);
  if (!payload || isExpired(payload)) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    return null;
  }
  try {
    const user = JSON.parse(userRaw) as AuthUser;
    return { token, user, payload };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (s) {
      setToken(s.token);
      setUser(s.user);
    }
    setIsReady(true);
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    sessionStorage.setItem(TOKEN_KEY, newToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, login, logout, isReady }),
    [user, token, login, logout, isReady]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

// Map role -> default landing path.
export function homePathFor(role: Role): string {
  switch (role) {
    case "cashier_user":
      return "/checkout";
    case "receiver_user":
      return "/receiving";
    case "owner":
      return "/dashboard";
    case "superadmin":
      return "/admin";
  }
}