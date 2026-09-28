import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { DnsChange, DnsChangesResponse, DnsRecord, McpTokensResponse, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

const PAGE = 30;
const FIELDS = ["type", "name", "content", "ttl", "proxied", "priority", "line", "weight", "comment", "status"] as const;
type Field = (typeof FIELDS)[number];

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
const ACTION_CLASS: Record<DnsChange["action"], string> = {
  create: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  update: "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400",
  delete: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export function Changes() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const domain = params.get("domain") ?? "";
  const token = params.get("token") ?? "";
  const { data: zoneData } = useFetch<{ zones: ZoneWithProvider[] }>("/api/zones", { cacheTtl: 604800 });
  const { data: tokenData } = useFetch<McpTokensResponse>(token ? "/api/mcp-tokens" : null);
  const [list, setList] = useState<DnsChange[]>([]);
  const [meta, setMeta] = useState<{ nextCursor: number | null; total: number; cap: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (cursor: number) => {
      const q = new URLSearchParams({ limit: String(PAGE), cursor: String(cursor) });
      if (domain) q.set("domain", domain);
      if (token) q.set("token", token);
      return apiFetch<DnsChangesResponse>(`/api/changes?${q.toString()}`);
    },
    [domain, token],
  );

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await query(0);
      setList(res.changes);
      setMeta({ nextCursor: res.nextCursor, total: res.total, cap: res.cap });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("changes.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  async function loadMore() {
    if (meta?.nextCursor == null) return;
    setLoadingMore(true);
    try {
      const res = await query(meta.nextCursor);
      setList((l) => [...l, ...res.changes.filter((c) => !l.some((x) => x.id === c.id))]);
      setMeta({ nextCursor: res.nextCursor, total: res.total, cap: res.cap });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("changes.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  const zoneNames = Array.from(new Set((zoneData?.zones ?? []).map((z) => z.name))).sort();
  if (domain && !zoneNames.includes(domain)) zoneNames.unshift(domain);
  const tokenName = token === "env" ? "MCP_TOKEN (env)" : tokenData?.tokens.find((x) => x.id === token)?.name ?? token;

  function setFilter(key: "domain" | "token", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("changes.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("changes.subtitle")}</p>
        </div>
        <Button variant="secondary" onClick={() => { setLoading(true); void reload(); }}>
          {t("changes.refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={t("changes.domainFilter")}
          value={domain}
          onChange={(e) => setFilter("domain", e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">{t("changes.allDomains")}</option>
          {zoneNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {token && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            {t("changes.tokenFilter", { name: tokenName })}
            <button type="button" onClick={() => setFilter("token", "")} className="text-xs font-medium underline">{t("changes.clearFilter")}</button>
          </span>
        )}
        {meta && <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{t("changes.count", { n: meta.total, cap: meta.cap })}</span>}
      </div>

      {loading ? (
        <Spinner />
      ) : error && list.length === 0 ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : list.length === 0 ? (
        <EmptyState title={domain || token ? t("changes.emptyFiltered") : t("changes.empty")} />
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <ChangeItem key={c.id} change={c} onRestored={() => void reload()} />
          ))}
        </ul>
      )}

      {meta?.nextCursor != null && list.length > 0 && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} loading={loadingMore}>{t("changes.loadMore")}</Button>
        </div>
      )}
    </div>
  );
}

function fmt(field: Field, r: DnsRecord | null, t: (k: string) => string): string | null {
  if (!r) return null;
  const v = r[field as keyof DnsRecord];
  if (v === undefined || v === null || v === "") return null;
  if (field === "proxied") return v ? t("changes.proxiedYes") : t("changes.proxiedNo");
  if (field === "ttl" && v === 1) return "auto";
  return String(v);
}

function hostOf(c: DnsChange): string {
  const r = c.after ?? c.before;
  if (!r) return c.domain;
  const n = r.name.replace(/\.$/, "");
  if (n === "@" || n === c.domain) return c.domain;
  return n.endsWith(`.${c.domain}`) ? n : `${n}.${c.domain}`;
}

function ChangeItem({ change: c, onRestored }: { change: DnsChange; onRestored: () => void }) {
  const { t } = useLang();
  const [mode, setMode] = useState<"idle" | "confirm" | "conflict" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const rec = c.after ?? c.before;
  const host = hostOf(c);
  const rows = FIELDS.filter((f) => fmt(f, c.before, t) !== null || fmt(f, c.after, t) !== null);
  const restorable = c.status !== "error" || !!c.before;

  async function restore(force: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/changes/${c.id}/restore`, { method: "POST", body: { force } });
      setMode("done");
      setTimeout(onRestored, 900);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const p = e.payload as { conflicts?: string[] } | undefined;
        setConflicts(p?.conflicts?.length ? p.conflicts : [e.message]);
        setMode("conflict");
      } else {
        setErr(e instanceof Error ? e.message : t("changes.restoreFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${pill} ${ACTION_CLASS[c.action]}`}>{t(`changes.action.${c.action}`)}</span>
              {rec && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{rec.type}</span>}
              <span className="break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{host}</span>
              {c.status === "error" && <span className={`${pill} bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400`}>{t("changes.status.error")}</span>}
              {c.status === "pending" && <span className={`${pill} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>{t("changes.status.pending")}</span>}
              {c.restoredBy && <span className={`${pill} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>{t("changes.restored")}</span>}
              {c.restoreOf && <span className={`${pill} bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300`}>{t("changes.isRestore")}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <time dateTime={c.ts}>{new Date(c.ts).toLocaleString()}</time>
              <span>{c.domain} · {c.providerName}</span>
              <span>
                {t("changes.by")}: <span className="font-medium text-slate-700 dark:text-slate-200">[{t(`changes.source.${c.source}`)}] {c.actor}</span>
              </span>
              {c.ip && <span>{t("changes.ip")}: <span className="font-mono">{c.ip}</span></span>}
              {c.operation && <span className="font-mono">{c.operation}</span>}
            </div>
          </div>
          {restorable && mode === "idle" && (
            <Button variant="secondary" onClick={() => setMode("confirm")} aria-label={t("changes.restoreAria", { name: host })} className="px-3 py-1.5 text-xs">
              {t("changes.restore")}
            </Button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="w-24 py-1.5 pr-3 font-medium" />
                <th className="py-1.5 pr-3 font-medium">{t("changes.before")}</th>
                <th className="py-1.5 font-medium">{t("changes.after")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const b = fmt(f, c.before, t);
                const a = fmt(f, c.after, t);
                const changed = b !== a;
                return (
                  <tr key={f} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">{t(`changes.field.${f}`)}</td>
                    <td className={`break-all py-1.5 pr-3 font-mono ${changed && b !== null ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300" : "text-slate-700 dark:text-slate-300"}`}>
                      {b ?? <span className="text-slate-400">{c.before ? "—" : t("changes.none")}</span>}
                    </td>
                    <td className={`break-all py-1.5 font-mono ${changed && a !== null ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "text-slate-700 dark:text-slate-300"}`}>
                      {a ?? <span className="text-slate-400">{c.after ? "—" : t("changes.none")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {c.error && <p className="mt-2 text-xs text-red-600">{t("changes.error")}: {c.error}</p>}
        {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}

        {mode === "confirm" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/20 dark:text-brand-200">
            <span>{t(`changes.restoreConfirm.${c.action}`)}</span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy} className="px-3 py-1 text-xs">{t("changes.cancel")}</Button>
              <Button onClick={() => restore(false)} loading={busy} className="px-3 py-1 text-xs">{t("changes.confirmRestore")}</Button>
            </span>
          </div>
        )}

        {mode === "conflict" && (
          <div role="alertdialog" aria-label={t("changes.conflictTitle")} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-semibold">{t("changes.conflictTitle")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {conflicts.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy} className="px-3 py-1 text-xs">{t("changes.cancel")}</Button>
              <Button variant="danger" onClick={() => restore(true)} loading={busy} className="px-3 py-1 text-xs">{t("changes.forceRestore")}</Button>
            </div>
          </div>
        )}

        {mode === "done" && <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("changes.restoreDone")}</p>}
      </Card>
    </li>
  );
}
