import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { DnsChange, DnsChangesResponse, DnsRecord, McpTokensResponse, ZoneWithProvider } from "@/lib/types";
import { PageHeader, UpdatingPill } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
import { SkeletonList } from "@/components/Skeleton";
import { inputClass } from "@/components/Input";

const PAGE = 30;
const FIELDS = ["type", "name", "content", "ttl", "proxied", "priority", "line", "weight", "comment", "status"] as const;
type Field = (typeof FIELDS)[number];

export function Changes() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const domain = params.get("domain") ?? "";
  const token = params.get("token") ?? "";
  const { data: zoneData } = useFetch<{ zones: ZoneWithProvider[] }>("/api/zones");
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
    <div className="space-y-6">
      <PageHeader
        title={t("changes.title")}
        subtitle={t("changes.subtitle")}
        status={loadingMore ? <UpdatingPill label={t("changes.loadMore")} /> : undefined}
        actions={
          <Button variant="secondary" onClick={() => { setLoading(true); void reload(); }} aria-label={t("changes.refresh")}>
            <Icon name="refresh" size={16} />
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="changes-domain">{t("changes.domainFilter")}</label>
        <select
          id="changes-domain"
          value={domain}
          onChange={(e) => setFilter("domain", e.target.value)}
          className={`${inputClass} sm:max-w-xs`}
        >
          <option value="">{t("changes.allDomains")}</option>
          {zoneNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {token && (
          <span className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full bg-brand-50 py-1 pl-3.5 pr-1.5 text-sm text-brand-900 ring-1 ring-inset ring-brand-200/80 dark:bg-brand-400/10 dark:text-brand-100 dark:ring-brand-400/20 sm:self-auto">
            <Icon name="key" size={15} />
            <span className="min-w-0 truncate">{t("changes.tokenFilter", { name: tokenName })}</span>
            <Button variant="ghost" size="sm" onClick={() => setFilter("token", "")}>{t("changes.clearFilter")}</Button>
          </span>
        )}
        {meta && (
          <p className="text-xs text-slate-500 dark:text-slate-400 sm:ml-auto">{t("changes.count", { n: meta.total, cap: meta.cap })}</p>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error && list.length === 0 ? (
        <ErrorNote message={error} onRetry={() => void reload()} retryLabel={t("common.retry")} />
      ) : list.length === 0 ? (
        <div className="surface flex items-center gap-3 px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
          <Icon name="history" size={20} className="text-brand-500" />
          {domain || token ? t("changes.emptyFiltered") : t("changes.empty")}
        </div>
      ) : (
        <ul className="stagger space-y-3">
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
  const tone = c.action === "create" ? "success" : c.action === "delete" ? "danger" : "brand";
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
    <li className="surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot>{t(`changes.action.${c.action}`)}</Badge>
            {rec && <Badge tone="neutral">{rec.type}</Badge>}
            <span className="min-w-0 break-all font-mono text-[15px] font-semibold text-slate-900 dark:text-white">{host}</span>
            {c.status === "error" && <Badge tone="danger">{t("changes.status.error")}</Badge>}
            {c.status === "pending" && <Badge tone="warning">{t("changes.status.pending")}</Badge>}
            {c.restoredBy && <Badge tone="success">{t("changes.restored")}</Badge>}
            {c.restoreOf && <Badge tone="accent">{t("changes.isRestore")}</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <time dateTime={c.ts}>{new Date(c.ts).toLocaleString()}</time>
            <span>{c.domain} · {c.providerName}</span>
            <span className="inline-flex items-center gap-1.5">
              <Badge tone={c.source === "mcp" ? "warning" : "neutral"} className="!h-5 !px-2 !text-[11px]">{t(`changes.source.${c.source}`)}</Badge>
              <span className="break-all text-slate-700 dark:text-slate-200">{c.actor}</span>
            </span>
            {c.ip && <span>{t("changes.ip")}: <span className="font-mono">{c.ip}</span></span>}
            {c.operation && <span className="font-mono text-[11px]">{c.operation}</span>}
          </div>
        </div>
        {restorable && mode === "idle" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMode("confirm")}
            aria-label={t("changes.restoreAria", { name: host })}
            className="self-start md:shrink-0"
          >
            <Icon name="history" size={15} />
            {t("changes.restore")}
          </Button>
        )}
      </div>

      {/* Before / after diff */}
      <div className="mt-3.5 overflow-hidden rounded-xl ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.07]">
        <div className="grid grid-cols-[5.5rem_1fr_1fr] bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/[0.03] dark:text-slate-400 sm:grid-cols-[7rem_1fr_1fr]">
          <span className="px-3 py-2" />
          <span className="px-3 py-2">{t("changes.before")}</span>
          <span className="px-3 py-2">{t("changes.after")}</span>
        </div>
        {rows.map((f) => {
          const b = fmt(f, c.before, t);
          const a = fmt(f, c.after, t);
          const changed = b !== a;
          return (
            <div key={f} className="grid grid-cols-[5.5rem_1fr_1fr] border-t border-black/[0.05] text-[13px] dark:border-white/[0.06] sm:grid-cols-[7rem_1fr_1fr]">
              <span className="px-3 py-2 text-slate-500 dark:text-slate-400">{t(`changes.field.${f}`)}</span>
              <span className={`min-w-0 break-all px-3 py-2 font-mono ${changed && b !== null ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" : "text-slate-700 dark:text-slate-200"}`}>
                {b ?? <span className="text-slate-400">{c.before ? "—" : t("changes.none")}</span>}
              </span>
              <span className={`min-w-0 break-all px-3 py-2 font-mono ${changed && a !== null ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" : "text-slate-700 dark:text-slate-200"}`}>
                {a ?? <span className="text-slate-400">{c.after ? "—" : t("changes.none")}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {c.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t("changes.error")}: {c.error}</p>
      )}
      {err && <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{err}</p>}

      {mode === "confirm" && (
        <div className="mt-3.5 flex animate-pop-in flex-col gap-3 rounded-xl bg-brand-50 p-3.5 ring-1 ring-inset ring-brand-200/80 dark:bg-brand-400/10 dark:ring-brand-400/20 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-900 dark:text-brand-100">{t(`changes.restoreConfirm.${c.action}`)}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode("idle")} disabled={busy} className="flex-1 sm:flex-none">{t("changes.cancel")}</Button>
            <Button size="sm" onClick={() => restore(false)} loading={busy} className="flex-1 sm:flex-none">{t("changes.confirmRestore")}</Button>
          </div>
        </div>
      )}

      {mode === "conflict" && (
        <div role="alertdialog" aria-label={t("changes.conflictTitle")} className="mt-3.5 animate-pop-in rounded-xl bg-amber-50 p-3.5 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/20">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Icon name="alert" size={16} />
            {t("changes.conflictTitle")}
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[13px] text-amber-900 dark:text-amber-100">
            {conflicts.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode("idle")} disabled={busy} className="flex-1 sm:flex-none">{t("changes.cancel")}</Button>
            <Button variant="danger" size="sm" onClick={() => restore(true)} loading={busy} className="flex-1 sm:flex-none">{t("changes.forceRestore")}</Button>
          </div>
        </div>
      )}

      {mode === "done" && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <Icon name="check" size={16} />
          {t("changes.restoreDone")}
        </p>
      )}
    </li>
  );
}
