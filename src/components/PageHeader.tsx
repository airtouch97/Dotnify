import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** Extra inline status next to actions (e.g. "Updating…"). */
  status?: ReactNode;
}

/** Large-title page header. Stacks on phones; actions wrap instead of overflowing. */
export function PageHeader({ title, subtitle, actions, back, status }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="pressable -ml-1.5 mb-2 inline-flex h-8 items-center gap-0.5 rounded-full pl-0.5 pr-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-400/10 max-sm:h-11"
          >
            <Icon name="chevron-left" size={18} />
            {back.label}
          </Link>
        )}
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-slate-900 dark:text-white sm:text-[32px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {(actions || status) && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {status}
          {actions}
        </div>
      )}
    </header>
  );
}

/** Subtle "refreshing in background" indicator. */
export function UpdatingPill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-7 animate-fade-in items-center gap-1.5 rounded-full bg-brand-50 px-2.5 text-xs font-medium text-brand-800 dark:bg-brand-400/10 dark:text-brand-200" role="status">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
      </span>
      {label}
    </span>
  );
}

/** Section title used above grouped lists (iOS "inset grouped" style). */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`mb-2.5 px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400 ${className}`}>
      {children}
    </h2>
  );
}
