interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  /** Labels for the on/off state shown when both label and hint are present. Defaults to "On"/"Off". */
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
}

/** iOS-style switch. The visual track is 28px; an invisible halo extends the hit area to 44px. */
export function Toggle({ checked, onChange, label, hint, onLabel = "On", offLabel = "Off", disabled }: ToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-out before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`motion-transform pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-200 ease-out ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
      {hint && !label && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {hint && label && (
        <p className={`text-xs ${checked ? "text-slate-600 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
          {checked ? onLabel : offLabel} — {hint}
        </p>
      )}
    </div>
  );
}
