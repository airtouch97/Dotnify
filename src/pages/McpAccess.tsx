import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { McpToken, McpTokensResponse } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Skeleton } from "@/components/Skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
import { CodeBlock, CopyButton } from "@/components/CopyButton";

const PLACEHOLDER = "YOUR_MCP_TOKEN";

/** Build ready-to-paste client configs for the given endpoint + token. */
export function buildSnippets(endpoint: string, token: string) {
  const cursor = JSON.stringify(
    { mcpServers: { dotnify: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        dotnify: {
          command: "npx",
          args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${DOTNIFY_AUTH}"],
          env: { DOTNIFY_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  const claudeCode = `claude mcp add --transport http dotnify ${endpoint} \\\n  --header "Authorization: Bearer ${token}"`;
  const curl = [
    `curl -s ${endpoint} \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  ].join("\n");
  return { cursor, claudeDesktop, claudeCode, curl };
}

export function McpAccess() {
  const { t } = useLang();
  const { data, loading, error, refetch } = useFetch<McpTokensResponse>("/api/mcp-tokens");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; record: McpToken } | null>(null);

  const endpoint = `${window.location.origin}/api/mcp`;
  const snippets = buildSnippets(endpoint, created?.token ?? PLACEHOLDER);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError(t("mcp.nameRequired"));
    setBusy(true);
    try {
      const res = await apiFetch<{ token: string; record: McpToken }>("/api/mcp-tokens", { method: "POST", body: { name: name.trim() } });
      setCreated(res);
      setName("");
      void refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("mcp.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  const tokens = data?.tokens ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("mcp.title")} subtitle={t("mcp.subtitle")} />

      <Card title={t("mcp.endpointTitle")}>
        <div className="flex flex-col gap-4 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-r from-brand-50 to-brand-100/60 p-3.5 ring-1 ring-inset ring-brand-200/70 dark:from-brand-400/10 dark:to-brand-300/5 dark:ring-brand-400/20 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">{t("mcp.endpoint")}</span>
            <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-900 dark:text-white">{endpoint}</code>
            <CopyButton text={endpoint} className="self-start sm:self-auto" />
          </div>
          <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt className="text-slate-500 dark:text-slate-400">{t("mcp.transport")}</dt>
            <dd className="text-slate-800 dark:text-slate-100">
              Streamable HTTP (POST, JSON) ·{" "}
              <code className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-white/[0.08] dark:text-slate-100">Authorization: Bearer &lt;token&gt;</code>
            </dd>
          </dl>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("mcp.stepsHint")}</p>
        </div>
      </Card>

      <Card title={t("mcp.createTitle")} description={t("mcp.createDesc")}>
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Input
              name="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("mcp.namePlaceholder")}
              maxLength={64}
              error={formError}
              aria-label={t("mcp.namePlaceholder")}
              enterKeyHint="done"
            />
          </div>
          <Button type="submit" loading={busy}>
            <Icon name="key" size={16} />
            {t("mcp.generate")}
          </Button>
        </form>
      </Card>

      {created && (
        <Card
          title={t("mcp.createdTitle", { name: created.record.name })}
          description={t("mcp.createdDesc")}
          actions={<Button variant="ghost" onClick={() => setCreated(null)}>{t("mcp.done")}</Button>}
          className="animate-pop-in ring-2 ring-amber-300/80 dark:ring-amber-500/50"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-amber-50 px-3 py-2 font-mono text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">{created.token}</code>
            <CopyButton text={created.token} className="self-start sm:self-auto" />
          </div>
        </Card>
      )}

      <Card title={t("mcp.tokensTitle")}>
        {tokens.length > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl bg-amber-50 p-3.5 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Icon name="alert" size={18} className="mt-0.5 text-amber-600 dark:text-amber-300" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t("mcp.leakTitle")}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-amber-900/90 dark:text-amber-100/90">{t("mcp.leakDesc")}</p>
              </div>
            </div>
            <Link
              to="/changes"
              className="pressable inline-flex h-10 shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-white px-4 text-sm font-medium text-slate-800 shadow-xs ring-1 ring-inset ring-black/[0.09] hover:bg-slate-50 dark:bg-white/[0.08] dark:text-slate-100 dark:ring-white/10 max-sm:h-11 sm:self-auto"
            >
              <Icon name="history" size={16} />
              {t("mcp.openChanges")}
            </Link>
          </div>
        )}
        {loading ? (
          <div className="space-y-3 py-1" aria-label={t("mcp.loading")} role="status">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : error ? (
          <ErrorNote message={error} onRetry={() => void refetch()} retryLabel={t("common.retry")} />
        ) : tokens.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
            <Icon name="key" size={18} className="text-brand-500" />
            {t("mcp.noTokens")}
          </div>
        ) : (
          <ul className="-my-1 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {tokens.map((tk) => (
              <TokenRow key={tk.id} token={tk} onRevoked={() => { if (created?.record.id === tk.id) setCreated(null); void refetch(); }} />
            ))}
          </ul>
        )}
        {data?.envTokenConfigured && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("mcp.envTokenNote")}</p>
        )}
      </Card>

      <Card title={t("mcp.configTitle")} description={created ? t("mcp.configDescFilled") : t("mcp.configDescPlaceholder")}>
        <div className="flex flex-col gap-4">
          <CodeBlock title="Cursor — ~/.cursor/mcp.json" code={snippets.cursor} />
          <CodeBlock title="Claude Desktop — claude_desktop_config.json (mcp-remote)" code={snippets.claudeDesktop} hint={t("mcp.claudeDesktopHint")} />
          <CodeBlock title="Claude Code" code={snippets.claudeCode} />
          <CodeBlock title="Streamable HTTP / curl" code={snippets.curl} hint={t("mcp.curlHint")} />
        </div>
      </Card>
    </div>
  );
}

function TokenRow({ token, onRevoked }: { token: McpToken; onRevoked: () => void }) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/mcp-tokens/${token.id}`, { method: "DELETE" });
      onRevoked();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mcp.revokeFailed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200">
          <Icon name="key" size={17} />
        </span>
        <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{token.name}</span>
          <code className="font-mono text-xs text-slate-500 dark:text-slate-400">{token.prefix}…</code>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span>{t("mcp.created")}: {new Date(token.createdAt).toLocaleString()}</span>
          <span>{t("mcp.lastUsed")}: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : t("mcp.never")}</span>
          {token.lastUsedIp && (
            <span>{t("mcp.lastUsedIp")}: <span className="font-mono">{token.lastUsedIp}</span></span>
          )}
        </div>
        {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 pl-12 sm:items-end sm:pl-0">
        {confirming ? (
          <div className="flex animate-pop-in flex-col gap-2 rounded-xl bg-red-50 p-3 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:ring-red-500/20 sm:max-w-xs">
            <p className="text-[13px] text-red-800 dark:text-red-200">{t("mcp.revokeHint")}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy} className="flex-1">{t("servers.cancel")}</Button>
              <Button variant="danger" size="sm" onClick={revoke} loading={busy} className="flex-1">{t("mcp.confirmRevoke")}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/changes?token=${encodeURIComponent(token.id)}`}
              className="pressable inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-400/10 max-sm:h-11"
            >
              <Icon name="history" size={14} />
              {t("mcp.viewChanges")}
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(true)}
              aria-label={`${t("mcp.revoke")} ${token.name}`}
              className="!text-red-600 !ring-red-200 hover:!bg-red-50 dark:!text-red-400 dark:!ring-red-500/30 dark:hover:!bg-red-500/10"
            >
              <Icon name="trash" size={14} />
              {t("mcp.revoke")}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
