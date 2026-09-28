import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { McpToken, McpTokensResponse } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("mcp.title")}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("mcp.subtitle")}</p>
      </div>

      <Card title={t("mcp.endpointTitle")}>
        <div className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 dark:text-slate-500">{t("mcp.endpoint")}:</span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-700 dark:text-slate-100">{endpoint}</code>
            <CopyButton text={endpoint} />
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">{t("mcp.transport")}:</span> Streamable HTTP (POST, JSON) ·{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-700 dark:text-slate-100">Authorization: Bearer &lt;token&gt;</code>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("mcp.stepsHint")}</p>
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
            />
          </div>
          <Button type="submit" loading={busy}>{t("mcp.generate")}</Button>
        </form>
      </Card>

      {created && (
        <Card
          title={t("mcp.createdTitle", { name: created.record.name })}
          description={t("mcp.createdDesc")}
          actions={<Button variant="ghost" onClick={() => setCreated(null)}>{t("mcp.done")}</Button>}
          className="border-amber-300 dark:border-amber-600"
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-amber-50 px-2 py-1 font-mono text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{created.token}</code>
            <CopyButton text={created.token} />
          </div>
        </Card>
      )}

      <Card title={t("mcp.tokensTitle")}>
        {loading ? (
          <Spinner label={t("mcp.loading")} />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("mcp.noTokens")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
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
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{token.name}</span>
          <code className="font-mono text-xs text-slate-400">{token.prefix}…</code>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-6 text-xs text-slate-500 dark:text-slate-400">
          <span>{t("mcp.created")}: {new Date(token.createdAt).toLocaleString()}</span>
          <span>{t("mcp.lastUsed")}: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : t("mcp.never")}</span>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {confirming ? (
          <>
            <Button variant="danger" onClick={revoke} loading={busy}>{t("mcp.confirmRevoke")}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{t("servers.cancel")}</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
            {t("mcp.revoke")}
          </Button>
        )}
      </div>
    </li>
  );
}
