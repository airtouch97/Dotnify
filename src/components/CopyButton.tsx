import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { Icon } from "./Icon";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (e.g. http on a LAN IP)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useLang();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-live="polite"
      className={`no-min-tap pressable relative inline-flex h-7 items-center gap-1 rounded-full before:absolute before:-inset-2 before:content-[''] px-2.5 text-xs font-medium ring-1 ring-inset ${
        state === "copied"
          ? "bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/30"
          : state === "failed"
            ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30"
            : "bg-white text-slate-600 ring-black/[0.09] hover:bg-slate-50 hover:text-slate-900 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10 dark:hover:bg-white/[0.1]"
      } ${className}`}
    >
      <Icon name={state === "copied" ? "check" : "copy"} size={13} />
      {state === "copied" ? t("common.copied") : state === "failed" ? t("common.copyFailed") : t("common.copy")}
    </button>
  );
}

/** A titled, copyable code block. */
export function CodeBlock({ title, code, hint }: { title: string; code: string; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-slate-50 ring-1 ring-inset ring-black/[0.06] dark:bg-black/30 dark:ring-white/[0.08]">
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-3.5 py-2 dark:border-white/[0.06]">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</span>
        <CopyButton text={code} />
      </div>
      {hint && <p className="px-3.5 pt-2.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <pre className="scroll-x p-3.5 font-mono text-[12.5px] leading-relaxed text-slate-800 dark:text-slate-100">{code}</pre>
    </div>
  );
}
