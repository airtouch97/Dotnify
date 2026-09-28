import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n";
import type { SetupResponse } from "@/lib/types";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export function Setup() {
  const { refresh } = useAuth();
  const { t } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("setup.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("setup.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch<SetupResponse>("/api/auth/setup", {
        method: "POST",
        noAuth: true,
        body: { username, password },
      });
      // Re-run the root loader; SetupGuard will see setupRequired=false and
      // redirect to / (then IndexRedirect -> /login) automatically.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-10 sm:py-16">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-5">
            <div aria-hidden="true" className="absolute inset-0 -z-10 scale-150 rounded-full bg-gradient-to-br from-brand-200 via-brand-300/60 to-transparent opacity-70 blur-2xl dark:from-brand-500/30 dark:via-brand-300/10" />
            <img src="/favicon.png" alt="" className="h-16 w-16 drop-shadow-sm" />
          </div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em] text-slate-900 dark:text-white">{t("setup.title")}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">{t("setup.description")}</p>
        </div>
        <div className="surface p-6 sm:p-8">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label={t("setup.username")}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            required
            minLength={3}
          />
          <Input
            label={t("setup.password")}
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            hint={t("setup.passwordHint")}
          />
          <Input
            label={t("setup.confirmPassword")}
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            error={error}
          />
          <Button type="submit" size="lg" loading={busy} className="mt-2 w-full">
            {t("setup.createAdmin")}
          </Button>
        </form>
        </div>
      </div>
    </div>
  );
}
