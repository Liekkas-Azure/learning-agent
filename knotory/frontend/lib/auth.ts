const TOKEN_KEY = "knotory_auth_token";
const USER_KEY = "knotory_auth_user";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
};

export function authRequiredFromEnv(): boolean {
  return process.env.NEXT_PUBLIC_KNOTORY_AUTH_REQUIRED === "true";
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  document.cookie = `knotory_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = "knotory_token=; path=/; max-age=0; SameSite=Lax";
}

export function isLoggedIn(): boolean {
  return Boolean(getAuthToken());
}
