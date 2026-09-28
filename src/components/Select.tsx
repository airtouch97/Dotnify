import { useState, useRef, useEffect, useId } from "react";
import { Icon } from "./Icon";

interface SelectOption {
  value: number | string;
  label: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: number | string;
  onChange: (value: number | string) => void;
  disabled?: boolean;
  className?: string;
}

export function Select({ label, options, value, onChange, disabled, className = "" }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} ref={ref}>
      {label && (
        <label id={labelId} className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={label ? labelId : undefined}
          onClick={() => !disabled && setOpen(!open)}
          className={`flex h-10 w-full items-center justify-between gap-2 rounded-xl px-3.5 text-left text-sm shadow-xs ring-1 ring-inset transition-[box-shadow,background-color] duration-160 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed ${
            disabled
              ? "bg-slate-100 text-slate-500 ring-black/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:ring-white/[0.06]"
              : "bg-white text-slate-900 ring-black/[0.1] hover:ring-black/20 dark:bg-white/[0.06] dark:text-slate-100 dark:ring-white/10 dark:hover:ring-white/20"
          }`}
        >
          <span className="truncate">{selected?.label ?? value}</span>
          {!disabled && (
            <Icon
              name="chevron-down"
              size={16}
              className={`text-slate-400 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {open && !disabled && (
          <div
            role="listbox"
            className="select-dropdown absolute z-30 mt-1.5 max-h-64 w-full min-w-[10rem] origin-top animate-pop-in overflow-auto rounded-xl bg-white p-1 shadow-pop dark:bg-slate-800 dark:shadow-pop-dark"
          >
            {options.map((opt) => {
              const isSel = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-120 ${
                    isSel
                      ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-400/15 dark:text-brand-200"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.08]"
                  }`}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {isSel && <Icon name="check" size={16} className="text-brand-600 dark:text-brand-300" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
