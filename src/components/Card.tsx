import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Card({ title, description, actions, children, className = "", bodyClassName }: CardProps) {
  const flush = /\bp-0\b/.test(className);
  return (
    <section className={`surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-col gap-3 px-5 pb-1 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold leading-snug text-slate-900 dark:text-slate-50">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName ?? (flush ? "" : "p-5 sm:p-6")}>{children}</div>
    </section>
  );
}
