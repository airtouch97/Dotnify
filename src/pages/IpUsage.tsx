import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { AddressRecordsResponse, ServerEntry, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";
import { serverSaveError } from "@/lib/server-errors";
import { Link } from "react-router-dom";

/** Parallel per-domain requests. Kept low to stay under the API rate limit (60 req/min). */
const CONCURRENCY = 3;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 20_000;

interface IpGroup {
  ip: string;
  type: "A" | "AAAA";
  records: { hostname: string; domain: string; recordId: string }[];
}

interface ScanState {
  running: boolean;
  done: number;
  total: number;
  waiting: boolean; // paused because of HTTP 429
  errors: { domain: string; message: string }[];
  vercelRecords: number;
  vercelCnames: number;
  finishedAt: number | null;
}

const IDLE: ScanState = { running: false, done: 0, total: 0, waiting: false, errors: [], vercelRecords: 0, vercelCnames: 0, finishedAt: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ipKey(ip: string): string {
  return ip.trim().toLowerCase();
}

export function IpUsage() {
  const { t } = useLang();
  const { data: zonesData, loading: zonesLoading, error: zonesError } = useFetch<{ zones: ZoneWithProvider[] }>("/api/zones", { cacheTtl: 604800 });
  const { data: servers, refetch: refetchServers } = useFetch<ServerEntry[]>("/api/servers");
  const zones = zonesData?.zones ?? [];

  const [scan, setScan] = useState<ScanState>(IDLE);
  const [groups, setGroups] = useState<Map<string, IpGroup>>(new Map());
  const [threshold, setThreshold] = useState(2);
  const [query, setQuery] = useState("");
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const serverByIp = useMemo(() => {
    const m = new Map<string, ServerEntry>();
    for (const s of servers ?? []) m.set(ipKey(s.ip), s);
    return m;
  }, [servers]);

  async function fetchZone(z: ZoneWithProvider): Promise<AddressRecordsResponse> {
    const path = `/api/zones/${encodeURIComponent(z.id)}/address-records?providerId=${encodeURIComponent(z.providerId)}&zoneName=${encodeURIComponent(z.name)}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await apiFetch<AddressRecordsResponse>(path);
      } catch (e) {
        if (e instanceof ApiError && e.status === 429 && attempt < RATE_LIMIT_RETRIES && !cancelled.current) {
          setScan((s) => ({ ...s, waiting: true }));
          await sleep(RATE_LIMIT_WAIT_MS);
          setScan((s) => ({ ...s, waiting: false }));
          continue;
        }
        throw e;
      }
    }
  }

  /** One request per domain from the browser, so no single server call scans everything. */
  async function startScan() {
    cancelled.current = false;
    const queue = [...zones];
    const acc = new Map<string, IpGroup>();
    setGroups(new Map());
    setScan({ ...IDLE, running: true, total: queue.length });

    const worker = async () => {
      while (queue.length > 0 && !cancelled.current) {
        const z = queue.shift()!;
        try {
          const res = await fetchZone(z);
          let vercel = 0;
          for (const r of res.records) {
            if (r.vercel) { vercel++; continue; }
            const k = ipKey(r.ip);
            const g = acc.get(k) ?? { ip: r.ip, type: r.type, records: [] };
            g.records.push({ hostname: r.hostname, domain: z.name, recordId: r.id });
            acc.set(k, g);
          }
          setGroups(new Map(acc));
          setScan((s) => ({ ...s, done: s.done + 1, vercelRecords: s.vercelRecords + vercel, vercelCnames: s.vercelCnames + res.vercelCnames }));
        } catch (e) {
          const message = e instanceof Error ? e.message : "Failed";
          setScan((s) => ({ ...s, done: s.done + 1, errors: [...s.errors, { domain: z.name, message }] }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (!cancelled.current) setScan((s) => ({ ...s, running: false, waiting: false, finishedAt: Date.now() }));
  }

  function stopScan() {
    cancelled.current = true;
    setScan((s) => ({ ...s, running: false, waiting: false }));
  }

  const q = query.trim().toLowerCase();
  const visible = [...groups.values()]
    .filter((g) => g.records.length >= Math.max(1, threshold))
    .filter((g) => {
      if (!q) return true;
      const srv = serverByIp.get(ipKey(g.ip));
      return g.ip.toLowerCase().includes(q) || (srv?.name.toLowerCase().includes(q) ?? false) || g.records.some((r) => r.hostname.includes(q));
    })
    .sort((a, b) => b.records.length - a.records.length || a.ip.localeCompare(b.ip));

  const pct = scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : 0;
  const hasResults = scan.running || scan.finishedAt !== null || scan.done > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("ips.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("ips.subtitle")}</p>
        </div>
        {scan.running ? (
          <Button variant="secondary" onClick={stopScan}>{t("ips.stop")}</Button>
        ) : (
          <Button onClick={() => void startScan()} disabled={zonesLoading || zones.length === 0}>
            {hasResults ? t("ips.rescan") : t("ips.scan")}
          </Button>
        )}
      </div>

      {zonesLoading && !zonesData ? (
        <Spinner />
      ) : zonesError ? (
        <Card><p className="text-sm text-red-600">{zonesError}</p></Card>
      ) : zones.length === 0 ? (
        <EmptyState title={t("ips.noDomains")} description={t("ips.noDomainsDesc")} />
      ) : !hasResults ? (
        <EmptyState title={t("ips.readyTitle")} description={t("ips.readyDesc", { count: zones.length })} action={<Button onClick={() => void startScan()}>{t("ips.scan")}</Button>} />
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                <span>
                  {scan.running ? t("ips.scanning", { done: scan.done, total: scan.total }) : t("ips.scanned", { done: scan.done, total: scan.total })}
                  {scan.waiting && <span className="ml-2 text-amber-600">{t("ips.rateLimited")}</span>}
                </span>
                <span className="font-mono text-xs text-slate-400">{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("ips.vercelExcluded", { records: scan.vercelRecords, cnames: scan.vercelCnames })}
              </p>
              {scan.errors.length > 0 && (
                <p className="text-xs text-red-600">
                  {t("ips.failedDomains")} {scan.errors.map((e) => `${e.domain} (${e.message})`).join(", ")}
                </p>
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-40">
              <Input
                label={t("ips.threshold")}
                name="threshold"
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="flex-1">
              <Input name="ip-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ips.searchPlaceholder")} />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("ips.summary", { shown: visible.length, total: groups.size, threshold })}
          </p>

          {visible.length === 0 ? (
            !scan.running && <EmptyState title={t("ips.noResults")} description={t("ips.noResultsDesc")} />
          ) : (
            <ul className="space-y-3">
              {visible.map((g) => (
                <IpRow key={g.ip} group={g} server={serverByIp.get(ipKey(g.ip))} onNamed={() => void refetchServers()} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function IpRow({ group, server, onNamed }: { group: IpGroup; server?: ServerEntry; onNamed: () => void }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  // idle → naming (new) / renaming (existing) → confirmRemove
  const [mode, setMode] = useState<"idle" | "naming" | "renaming" | "confirmRemove">("idle");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const PREVIEW = 5;
  const shown = expanded ? group.records : group.records.slice(0, PREVIEW);

  function startRename() {
    setName(server?.name ?? "");
    setError(null);
    setMode("renaming");
  }

  function cancel() {
    setMode("idle");
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError(t("servers.nameRequired"));
    if (mode === "renaming" && server && trimmed === server.name) return cancel();
    setBusy(true);
    try {
      if (mode === "renaming" && server) {
        await apiFetch(`/api/servers/${server.id}`, { method: "PATCH", body: { name: trimmed } });
      } else {
        await apiFetch("/api/servers", { method: "POST", body: { name: trimmed, ip: group.ip, note: t("ips.autoNote") } });
      }
      setMode("idle");
      setName("");
      onNamed();
    } catch (err) {
      setError(serverSaveError(err, trimmed, t));
    } finally {
      setBusy(false);
    }
  }

  async function removeName() {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/servers/${server.id}`, { method: "DELETE" });
      setMode("idle");
      onNamed();
    } catch (err) {
      setError(serverSaveError(err, server.name, t, "servers.deleteFailed"));
      setMode("renaming");
    } finally {
      setBusy(false);
    }
  }

  const editing = mode === "naming" || mode === "renaming";

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{group.ip}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{group.type}</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
              {t("ips.recordCount", { count: group.records.length })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <form onSubmit={save} className="flex flex-wrap items-center gap-2">
                {mode === "renaming" && <span className="text-xs text-slate-500 dark:text-slate-400">{t("ips.renameTitle")}</span>}
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
                  placeholder={t("servers.namePlaceholder")}
                  aria-label={mode === "renaming" ? t("ips.renameTitle") : t("ips.nameIt")}
                  maxLength={64}
                  className="w-40 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <Button type="submit" loading={busy} className="px-3 py-1 text-xs">{t("servers.save")}</Button>
                <Button type="button" variant="ghost" onClick={cancel} disabled={busy} className="px-2 py-1 text-xs">{t("servers.cancel")}</Button>
              </form>
            ) : server ? (
              <button
                type="button"
                onClick={startRename}
                aria-label={t("ips.renameAria", { name: server.name })}
                title={t("ips.rename")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
              >
                {t("ips.inTable")}: {server.name}
                <span className="rounded bg-white/70 px-1.5 text-[11px] text-emerald-800 dark:bg-white/10 dark:text-emerald-300">✎ {t("ips.rename")}</span>
              </button>
            ) : (
              <Button variant="secondary" onClick={() => { setName(""); setError(null); setMode("naming"); }} className="px-3 py-1 text-xs">{t("ips.nameIt")}</Button>
            )}
          </div>
        </div>
        {mode === "renaming" && server && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link to={`/servers?edit=${encodeURIComponent(server.id)}`} className="text-brand-600 hover:underline dark:text-brand-400">
              {t("ips.editInServers")} →
            </Link>
            <button type="button" onClick={() => { setError(null); setMode("confirmRemove"); }} disabled={busy} className="text-red-600 hover:underline disabled:opacity-50">
              {t("ips.removeName")}
            </button>
          </div>
        )}
        {mode === "confirmRemove" && server && (
          <div role="alertdialog" aria-label={t("ips.removeName")} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
            <span>{t("ips.removeConfirm", { name: server.name })}</span>
            <span className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setMode("renaming")} disabled={busy} className="px-3 py-1 text-xs">{t("servers.cancel")}</Button>
              <Button type="button" variant="danger" onClick={removeName} loading={busy} className="px-3 py-1 text-xs">{t("ips.confirmRemove")}</Button>
            </span>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {shown.map((r) => (
            <li key={`${r.domain}:${r.recordId}:${r.hostname}`} className="rounded bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              {r.hostname}
            </li>
          ))}
          {group.records.length > PREVIEW && (
            <li>
              <button type="button" onClick={() => setExpanded((v) => !v)} className="px-1 text-xs text-brand-600 hover:underline dark:text-brand-400">
                {expanded ? t("ips.showLess") : t("ips.showAll", { count: group.records.length })}
              </button>
            </li>
          )}
        </ul>
      </Card>
    </li>
  );
}
