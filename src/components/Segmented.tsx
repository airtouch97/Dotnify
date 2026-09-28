import type { ReactNode } from "react";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Apple-style segmented control. The selected "thumb" slides between equal-width
 * segments with a transform transition (interruptible, compositor-only).
 */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className = "" }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const width = 100 / options.length;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative grid rounded-full bg-black/[0.06] p-0.5 dark:bg-white/[0.08] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="motion-transform absolute bottom-0.5 left-0.5 top-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-250 ease-out dark:bg-slate-600"
        style={{ width: `calc(${width}% - 2px)`, transform: `translateX(calc(${index * 100}% + ${index * 2}px))` }}
      />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`no-min-tap relative z-[1] flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium transition-colors duration-160 focus-visible:outline-offset-0 max-sm:h-11 max-sm:min-w-11 ${
              active ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
