import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="surface flex animate-fade-in flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="mb-1 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200/70 text-brand-700 dark:from-brand-400/20 dark:to-brand-300/10 dark:text-brand-300">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.75 7.5 12 3.75l8.25 3.75L12 11.25 3.75 7.5Z" />
            <path d="M3.75 12 12 15.75 20.25 12M3.75 16.5 12 20.25l8.25-3.75" />
          </svg>
        )}
      </div>
      <h3 className="text-[17px] font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
