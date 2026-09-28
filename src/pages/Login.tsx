import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export function Login() {
  const { login } = useAuth();
  const { t } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // login() stores the token and calls revalidate(); the root loader
      // re-runs, LoginGuard sees authenticated=true and redirects to
      // /providers automatically — no manual navigate needed.
      await login(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
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
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em] text-slate-900 dark:text-white">{t("login.title")}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">{t("login.description")}</p>
        </div>
        <div className="surface p-6 sm:p-8">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label={t("login.username")}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label={t("login.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            error={error}
          />
          <Button type="submit" size="lg" loading={busy} className="mt-2 w-full">
            {t("login.signIn")}
          </Button>
        </form>
        </div>
      </div>
    </div>
  );
}
