import { Navigate, createBrowserRouter, useRouteLoaderData } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import { ROOT_LOADER_ID } from "@/lib/constants";
import { Layout } from "@/components/Layout";
import { Setup } from "@/pages/Setup";
import { Login } from "@/pages/Login";
import { Home } from "@/pages/Home";
import { Providers } from "@/pages/Providers";
import { Zones } from "@/pages/Zones";
import { Records } from "@/pages/Records";
import { Spinner } from "@/components/Spinner";

/**
 * Root loader: determine setup/login state. Re-runs whenever a consumer calls
 * useRevalidator().revalidate() (e.g. after login / logout).
 */
const DEFAULT_ME: MeResponse = { setupRequired: false, authenticated: false, username: null };

export async function rootLoader() {
  try {
    // Don't force noAuth: if a token exists in localStorage, send it so the
    // me endpoint can report authenticated=true right after login.
    const me = await apiFetch<MeResponse>("/api/auth/me", { allow401: true });
    return { me: me ?? DEFAULT_ME };
  } catch {
    return { me: DEFAULT_ME };
  }
}

function useMe(): MeResponse | undefined {
  const data = useRouteLoaderData(ROOT_LOADER_ID) as { me: MeResponse } | undefined;
  return data?.me;
}

function SpinnerShell() {
  return (
    <div className="grid h-screen place-items-center">
      <Spinner />
    </div>
  );
}

/**
 * Guard for /setup: only accessible while admin is NOT yet initialized.
 */
function SetupGuard() {
  const me = useMe();
  if (!me) return <SpinnerShell />;
  if (!me.setupRequired) return <Navigate to="/" replace />;
  return <Setup />;
}

/**
 * Guard for /login: redirect to /setup if admin missing, or to / if
 * already authenticated.
 */
function LoginGuard() {
  const me = useMe();
  if (!me) return <SpinnerShell />;
  if (me.setupRequired) return <Navigate to="/setup" replace />;
  if (me.authenticated) return <Navigate to="/" replace />;
  return <Login />;
}

/** Guard for authenticated routes. */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const me = useMe();
  if (!me) return <SpinnerShell />;
  if (me.setupRequired) return <Navigate to="/setup" replace />;
  if (!me.authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function IndexRedirect() {
  const me = useMe();
  if (!me) return <SpinnerShell />;
  if (me.setupRequired) return <Navigate to="/setup" replace />;
  if (!me.authenticated) return <Navigate to="/login" replace />;
  return <Home />;
}

export const router = createBrowserRouter([
  {
    id: ROOT_LOADER_ID,
    path: "/",
    loader: rootLoader,
    element: <Layout />,
    children: [
      { index: true, element: <IndexRedirect />, handle: { titleKey: "title.home" } },
      { path: "setup", element: <SetupGuard />, handle: { titleKey: "title.setup" } },
      { path: "login", element: <LoginGuard />, handle: { titleKey: "title.login" } },
      { path: "providers", element: <AuthGuard><Providers /></AuthGuard>, handle: { titleKey: "title.providers" } },
      { path: "domains", element: <AuthGuard><Zones /></AuthGuard>, handle: { titleKey: "title.domains" } },
      { path: "domains/:zoneId/records", element: <AuthGuard><Records /></AuthGuard>, handle: { titleKey: "" } },
      // Legacy redirect
      { path: "zones", element: <Navigate to="/domains" replace /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
