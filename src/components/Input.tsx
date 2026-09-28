import type { InputHTMLAttributes, Ref } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export const inputClass =
  "h-10 w-full rounded-xl bg-white px-3.5 text-sm text-slate-900 shadow-xs ring-1 ring-inset ring-black/[0.1] placeholder:text-slate-400 transition-[box-shadow,background-color] duration-160 ease-out hover:ring-black/20 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-500 dark:bg-white/[0.06] dark:text-slate-100 dark:ring-white/10 dark:placeholder:text-slate-500 dark:hover:ring-white/20 dark:focus:ring-brand-400 dark:disabled:bg-white/[0.03]";

export function Input({ label, error, hint, className = "", id, inputRef, ...rest }: InputProps) {
  const inputId = id ?? rest.name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${inputClass} ${
          error ? "ring-red-400 focus:ring-red-500 dark:ring-red-500/60" : ""
        } ${className}`}
        {...rest}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
