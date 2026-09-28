import { useState } from "react";
import { useLang } from "@/lib/i18n";

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
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${className}`}
    >
      {state === "copied" ? t("common.copied") : state === "failed" ? t("common.copyFailed") : t("common.copy")}
    </button>
  );
}

/** A titled, copyable code block. */
export function CodeBlock({ title, code, hint }: { title: string; code: string; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/50">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</span>
        <CopyButton text={code} />
      </div>
      {hint && <p className="px-3 pt-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-100">{code}</pre>
    </div>
  );
}
