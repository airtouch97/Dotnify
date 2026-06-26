import { useCallback } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/token";
import type { MeResponse } from "@/lib/types";
import { ROOT_LOADER_ID } from "@/lib/constants";

/**
 * Auth state is derived from the root route loader (single source of truth).
 * login / logout mutate the token then call `revalidate()` so the loader
 * re-runs and every consumer (guards, Layout, pages) stays in sync.
 */
export function useAuth() {
  const data = useRouteLoaderData(ROOT_LOADER_ID) as { me: MeResponse } | undefined;
  const revalidator = useRevalidator();
  const me = data?.me;

  const refresh = useCallback(async () => {
    revalidator.revalidate();
  }, [revalidator]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { token, username: confirmed } = await apiFetch<{
        token: string;
        username: string;
      }>("/api/auth/login", {
        method: "POST",
        noAuth: true,
        body: { username, password },
      });
      setToken(token);
      // Re-run the root loader so /api/auth/me reflects the new session.
      revalidator.revalidate();
      return confirmed;
    },
    [revalidator]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", allow401: true });
    } catch {
      // ignore network errors on logout
    }
    clearToken();
    revalidator.revalidate();
  }, [revalidator]);

  return {
    loading: !me,
    setupRequired: me?.setupRequired ?? false,
    authenticated: me?.authenticated ?? false,
    username: me?.username ?? null,
    token: getToken(),
    refresh,
    login,
    logout,
  };
}
