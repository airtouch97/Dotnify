import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "./Button";

const NAV = [
  { to: "/providers", label: "Providers" },
  { to: "/zones", label: "Zones" },
];

export function Layout() {
  const { username, logout, authenticated } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      // Hard refresh so the root loader re-runs from a clean state; avoids
      // any race between the in-flight revalidate and the route guards.
      window.location.assign("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">d</span>
          dotnify
        </Link>
        {authenticated && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              <span className="text-slate-400">signed in as</span>{" "}
              <span className="font-medium text-slate-700">{username}</span>
            </span>
            <Button variant="ghost" onClick={handleLogout} loading={busy} className="px-3 py-1.5 text-xs">
              Sign out
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {authenticated && (
          <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </aside>
        )}
        <main className="flex-1 overflow-auto bg-slate-50 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
