import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "tinted" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

// Primary uses the brand blue at the depth that keeps white text >= 4.5:1.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-button hover:bg-brand-700 disabled:bg-brand-600/45 disabled:shadow-none",
  secondary:
    "bg-white text-slate-800 shadow-xs ring-1 ring-inset ring-black/[0.09] hover:bg-slate-50 disabled:opacity-50 dark:bg-white/[0.08] dark:text-slate-100 dark:ring-white/10 dark:hover:bg-white/[0.12]",
  tinted:
    "bg-brand-100 text-brand-800 hover:bg-brand-200/80 disabled:opacity-50 dark:bg-brand-400/15 dark:text-brand-300 dark:hover:bg-brand-400/25",
  danger:
    "bg-red-600 text-white shadow-xs hover:bg-red-700 disabled:bg-red-600/45",
  ghost:
    "bg-transparent text-slate-600 hover:bg-black/[0.05] hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const base =
    "pressable inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed";
  return (
    <button
      className={`${base} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <ButtonSpinner />}
      {children}
    </button>
  );
}

function ButtonSpinner() {
  return (
    <svg className="animate-spin-fast" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
