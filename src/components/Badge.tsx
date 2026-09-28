import type { ReactNode } from "react";

type Tone = "brand" | "accent" | "neutral" | "success" | "warning" | "danger";

// Light palette stops carry dark text only (AA contrast).
const TONES: Record<Tone, string> = {
  brand: "bg-brand-100 text-brand-800 ring-brand-200/80 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/20",
  accent: "bg-brand-200/60 text-brand-900 ring-brand-300/60 dark:bg-brand-300/15 dark:text-brand-200 dark:ring-brand-300/20",
  neutral: "bg-slate-100 text-slate-600 ring-black/[0.05] dark:bg-white/[0.08] dark:text-slate-300 dark:ring-white/[0.06]",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200/70 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-200/70 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
  danger: "bg-red-50 text-red-700 ring-red-200/70 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20",
};

const DOTS: Record<Tone, string> = {
  brand: "bg-brand-500",
  accent: "bg-brand-400",
  neutral: "bg-slate-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export function Badge({ tone = "neutral", dot = false, children, className = "" }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Zone / domain status badge: "active" uses the brand aqua; others neutral. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={status === "active" ? "brand" : "neutral"} dot>
      {status}
    </Badge>
  );
}
