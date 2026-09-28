import { useState, useEffect, useRef, useCallback } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n";
import { AppearanceSwitch } from "./AppearanceSwitch";
import { LangSwitch } from "./LangSwitch";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export function Layout() {
  const { username, logout, authenticated } = useAuth();
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const matches = useMatches();
  const location = useLocation();

  useEffect(() => {
    const titleKey = (matches[matches.length - 1]?.handle as Record<string, string> | undefined)?.titleKey;
    if (titleKey === undefined || titleKey === "") return; // let the page manage its own title
    document.title = `${t(titleKey)} | Dotnify`;
  }, [matches, t]);

  // Close the mobile sheet whenever the route changes.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const NAV: NavItem[] = [
    { to: "/", label: t("nav.home"), icon: "home", end: true },
    { to: "/domains", label: t("nav.domains"), icon: "globe" },
    { to: "/servers", label: t("nav.servers"), icon: "server" },
    { to: "/ips", label: t("nav.ips"), icon: "network" },
    { to: "/providers", label: t("nav.providers"), icon: "plug" },
    { to: "/mcp", label: t("nav.mcp"), icon: "sparkles" },
    { to: "/changes", label: t("nav.changes"), icon: "history" },
  ];
  // Bottom tab bar: four primary destinations + "More" for the rest.
  const TABS = NAV.slice(0, 4);
  const OVERFLOW = NAV.slice(4);
  const overflowActive = OVERFLOW.some((n) => location.pathname.startsWith(n.to));

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      window.location.assign("/login");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header
          className="flex items-center justify-between gap-3 pl-[max(1.25rem,var(--safe-left))] pr-[max(1.25rem,var(--safe-right))] sm:px-8"
          style={{ paddingTop: "calc(var(--safe-top) + 0.75rem)" }}
        >
          <Brand />
          <div className="flex items-center gap-2">
            <LangSwitch />
            <span className="hidden sm:block">
              <AppearanceSwitch compact />
            </span>
          </div>
        </header>
        <main className="flex flex-1 flex-col" style={{ paddingBottom: "var(--safe-bottom)" }}>
          <div key={location.pathname} className="page-enter flex flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 z-30 hidden h-dvh w-64 shrink-0 flex-col border-r border-black/[0.06] bg-slate-100/80 backdrop-blur-xl dark:border-white/[0.06] dark:bg-black/40 lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group pressable flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
                  isActive
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/[0.04] dark:bg-white/[0.1] dark:text-white dark:ring-white/[0.06]"
                    : "text-slate-600 hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    name={item.icon}
                    size={18}
                    className={isActive ? "text-brand-600 dark:text-brand-300" : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"}
                  />
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-black/[0.06] p-4 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Avatar name={username} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">{t("header.signedInAs")}</p>
              <p className="truncate text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">{username}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={busy}
              title={t("header.signOut")}
              aria-label={t("header.signOut")}
              className="pressable grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <LangSwitch className="flex-1" />
            <AppearanceSwitch compact />
          </div>
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <header
        className="material sticky top-0 z-30 border-b border-black/[0.06] dark:border-white/[0.06] lg:hidden"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="flex h-12 items-center justify-between" style={{ paddingLeft: "max(1rem, var(--safe-left))", paddingRight: "max(1rem, var(--safe-right))" }}>
          <Brand small />
          <Avatar name={username} small />
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <div
          className="mx-auto w-full max-w-[68rem] pb-safe-tabbar pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12 lg:pt-10"
        >
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label={t("nav.main")}
        className="material fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.06] dark:border-white/[0.08] lg:hidden"
        style={{ paddingBottom: "var(--safe-bottom)", paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}
      >
        <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-lg grid-cols-5">
          {TABS.map((item) => (
            <li key={item.to} className="flex">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `pressable flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${
                    isActive ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon name={item.icon} size={24} strokeWidth={isActive ? 2 : 1.6} />
                    <span className="max-w-full truncate px-0.5">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="flex">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              className={`pressable flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${
                overflowActive || moreOpen ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Icon name="more" size={24} strokeWidth={overflowActive ? 2 : 1.6} />
              <span>{t("nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={OVERFLOW}
        username={username}
        onLogout={handleLogout}
        busy={busy}
      />
    </div>
  );
}

function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link to="/" className="tap pressable -mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1">
      <img src="/favicon.png" alt="" className={small ? "h-7 w-7" : "h-8 w-8"} />
      <span className={`font-semibold tracking-tight text-slate-900 dark:text-white ${small ? "text-[17px]" : "text-lg"}`}>Dotnify</span>
    </Link>
  );
}

function Avatar({ name, small = false }: { name: string | null; small?: boolean }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-200 via-brand-300 to-brand-500 font-semibold text-brand-950 ${
        small ? "h-8 w-8 text-[13px]" : "h-9 w-9 text-sm"
      }`}
    >
      {initial}
    </span>
  );
}

/**
 * iOS-style bottom sheet for secondary navigation + settings on phones.
 * - Enters and exits along the same path (from the bottom) with the drawer curve.
 * - Drag the grabber/header down to dismiss; a quick flick (velocity) is enough.
 * - Escape / scrim tap closes; focus moves in on open and returns on close.
 */
function MoreSheet({
  open,
  onClose,
  items,
  username,
  onLogout,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  username: string | null;
  onLogout: () => void;
  busy: boolean;
}) {
  const { t } = useLang();
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const drag = useRef<{ startY: number; startT: number; dy: number; id: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      sheetRef.current?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });
    }, 50);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      returnFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (drag.current) return; // ignore extra touch points
    drag.current = { startY: e.clientY, startT: performance.now(), dy: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !sheetRef.current) return;
    const raw = e.clientY - d.startY;
    // Rubber-band when pulling up past the resting position.
    const dy = raw < 0 ? -((-raw * 0.55 * 200) / (200 + 0.55 * -raw)) : raw;
    d.dy = dy;
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      const el = sheetRef.current;
      if (!el) return;
      el.style.transition = "";
      el.style.transform = "";
      const velocity = d.dy / Math.max(1, performance.now() - d.startT);
      if (d.dy > 90 || (d.dy > 10 && velocity > 0.11)) onClose();
    },
    [onClose],
  );

  return (
    <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/35 transition-opacity duration-300 ease-out ${open ? "opacity-100" : "opacity-0"}`}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.more")}
        className={`motion-transform absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] max-w-lg overflow-y-auto overscroll-contain rounded-t-[1.75rem] bg-slate-50 shadow-pop transition-[transform,opacity,visibility] ease-drawer dark:bg-slate-900 dark:shadow-pop-dark ${
          open ? "visible translate-y-0 opacity-100 duration-[360ms]" : "invisible translate-y-full opacity-0 duration-250"
        }`}
        style={{ paddingBottom: "calc(var(--safe-bottom) + 1rem)" }}
      >
        <div
          className="sticky top-0 z-[1] cursor-grab touch-none bg-slate-50/95 px-5 pb-2 pt-2.5 backdrop-blur dark:bg-slate-900/95"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
          <div className="mt-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t("nav.more")}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("nav.close")}
              className="tap-square pressable grid h-8 w-8 place-items-center rounded-full bg-black/[0.06] text-slate-600 dark:bg-white/10 dark:text-slate-300"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-6 px-4 pt-2">
          <ul className="overflow-hidden rounded-2xl bg-white shadow-xs dark:bg-white/[0.06]">
            {items.map((item) => (
              <li key={item.to} className="border-b border-black/[0.06] last:border-b-0 dark:border-white/[0.06]">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex min-h-[52px] items-center gap-3 px-4 transition-colors duration-120 active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                      isActive ? "text-brand-700 dark:text-brand-300" : "text-slate-900 dark:text-slate-100"
                    }`
                  }
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white">
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span className="flex-1 text-[15px] font-medium">{item.label}</span>
                  <Icon name="chevron-right" size={16} className="text-slate-400" />
                </NavLink>
              </li>
            ))}
          </ul>

          <section>
            <h3 className="mb-2 px-4 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("nav.settings")}</h3>
            <div className="space-y-4 rounded-2xl bg-white p-4 shadow-xs dark:bg-white/[0.06]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-slate-900 dark:text-slate-100">{t("language.label")}</span>
                <LangSwitch className="w-40" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-slate-900 dark:text-slate-100">{t("appearance.label")}</span>
                <AppearanceSwitch compact className="w-40" />
              </div>
            </div>
          </section>

          <div className="overflow-hidden rounded-2xl bg-white shadow-xs dark:bg-white/[0.06]">
            <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
              <Avatar name={username} />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("header.signedInAs")}</p>
                <p className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{username}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              disabled={busy}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-red-600 transition-colors duration-120 active:bg-black/[0.04] disabled:opacity-50 dark:text-red-400"
            >
              <Icon name="logout" size={18} />
              {t("header.signOut")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
