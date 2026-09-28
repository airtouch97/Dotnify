import { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useMatches } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n";
import { Button } from "./Button";
import { AppearanceSwitch } from "./AppearanceSwitch";
import { LangSwitch } from "./LangSwitch";

export function Layout() {
  const { username, logout, authenticated } = useAuth();
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const matches = useMatches();

  useEffect(() => {
    const titleKey = (matches[matches.length - 1]?.handle as Record<string, string> | undefined)?.titleKey;
    if (titleKey === undefined || titleKey === "") return; // let the page manage its own title
    document.title = `${t(titleKey)} | Dotnify`;
  }, [matches, t]);

  const NAV = [
    { to: "/", label: t("nav.home"), end: true },
    { to: "/domains", label: t("nav.domains") },
    { to: "/servers", label: t("nav.servers") },
    { to: "/ips", label: t("nav.ips") },
    { to: "/providers", label: t("nav.providers") },
    { to: "/mcp", label: t("nav.mcp") },
  ];

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      window.location.assign("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-800">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
          <img src="/favicon.png" alt="Dotnify" className="h-7 w-7" />
          Dotnify
        </Link>
        {authenticated && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              <span className="text-slate-400 dark:text-slate-500">{t("header.signedInAs")}</span>{" "}
              <span className="font-medium text-slate-700 dark:text-slate-200">{username}</span>
            </span>
            <Button variant="ghost" onClick={handleLogout} loading={busy} className="px-3 py-1.5 text-xs">
              {t("header.signOut")}
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {authenticated && (
          <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto flex items-center justify-between px-1">
              <LangSwitch />
              <AppearanceSwitch />
            </div>
          </aside>
        )}
        <main className="flex-1 overflow-auto bg-slate-50 p-6 dark:bg-slate-900">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
