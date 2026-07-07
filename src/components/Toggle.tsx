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

export function Toggle({ checked, onChange, label, hint, onLabel = "On", offLabel = "Off", disabled }: ToggleProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
          checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {hint && !label && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {hint && label && (
        <p className={`text-xs ${checked ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
          {checked ? onLabel : offLabel} — {hint}
        </p>
      )}
    </div>
  );
}
