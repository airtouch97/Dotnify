import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { AddressRecordsResponse, ServerEntry, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input, inputClass } from "@/components/Input";
import { SkeletonList } from "@/components/Skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
import { serverSaveError } from "@/lib/server-errors";
import { Link } from "react-router-dom";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

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
    <div className="space-y-6">
      <PageHeader
        title={t("ips.title")}
        subtitle={t("ips.subtitle")}
        actions={
          scan.running ? (
            <Button variant="secondary" onClick={stopScan}>
              <Icon name="x" size={16} />
              {t("ips.stop")}
            </Button>
          ) : (
            <Button onClick={() => void startScan()} disabled={zonesLoading || zones.length === 0}>
              <Icon name={hasResults ? "refresh" : "search"} size={16} />
              {hasResults ? t("ips.rescan") : t("ips.scan")}
            </Button>
          )
        }
      />

      {zonesLoading && !zonesData ? (
        <SkeletonList rows={3} />
      ) : zonesError ? (
        <Card><ErrorNote message={zonesError} /></Card>
      ) : zones.length === 0 ? (
        <EmptyState icon={<Icon name="globe" size={26} />} title={t("ips.noDomains")} description={t("ips.noDomainsDesc")} />
      ) : !hasResults ? (
        <EmptyState
          icon={<Icon name="network" size={26} />}
          title={t("ips.readyTitle")}
          description={t("ips.readyDesc", { count: zones.length })}
          action={<Button onClick={() => void startScan()}><Icon name="search" size={16} />{t("ips.scan")}</Button>}
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                <span className="flex flex-wrap items-center gap-2" aria-live="polite">
                  {scan.running && <Spinner size={14} />}
                  <span className="font-medium">
                    {scan.running ? t("ips.scanning", { done: scan.done, total: scan.total }) : t("ips.scanned", { done: scan.done, total: scan.total })}
                  </span>
                  {scan.waiting && <Badge tone="warning">{t("ips.rateLimited")}</Badge>}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div
                  className="h-full w-full origin-left rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-transform duration-300 ease-out"
                  style={{ transform: `scaleX(${pct / 100})` }}
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("ips.vercelExcluded", { records: scan.vercelRecords, cnames: scan.vercelCnames })}
              </p>
              {scan.errors.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t("ips.failedDomains")} {scan.errors.map((e) => `${e.domain} (${e.message})`).join(", ")}
                </p>
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-40">
              <Input
                inputMode="numeric"
                label={t("ips.threshold")}
                name="threshold"
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="relative flex-1">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-slate-500" />
              <Input
                name="ip-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("ips.searchPlaceholder")}
                aria-label={t("ips.searchPlaceholder")}
                className="pl-9"
                enterKeyHint="search"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("ips.summary", { shown: visible.length, total: groups.size, threshold })}
          </p>

          {visible.length === 0 ? (
            !scan.running && <EmptyState icon={<Icon name="search" size={26} />} title={t("ips.noResults")} description={t("ips.noResultsDesc")} />
          ) : (
            <ul className="stagger space-y-3">
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
  // idle → naming (new) | renaming (existing) | confirmRemove (existing)
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
    } finally {
      setBusy(false);
    }
  }

  const editingName = mode === "naming" || mode === "renaming";

  return (
    <li>
      <Card bodyClassName="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-all font-mono text-[15px] font-semibold text-slate-900 dark:text-white">{group.ip}</span>
            <Badge tone="neutral" className="font-mono">{group.type}</Badge>
            <Badge tone="brand">{t("ips.recordCount", { count: group.records.length })}</Badge>
          </div>
          {!editingName && mode !== "confirmRemove" && (
            <div className="flex items-center gap-2">
              {server ? (
                <button
                  type="button"
                  onClick={startRename}
                  aria-label={t("ips.renameAria", { name: server.name })}
                  title={t("ips.rename")}
                  className="pressable group inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-brand-200/60 pl-3 pr-1 text-[13px] font-medium text-brand-900 ring-1 ring-inset ring-brand-300/60 hover:bg-brand-200 dark:bg-brand-300/15 dark:text-brand-100 dark:ring-brand-300/20 dark:hover:bg-brand-300/25"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  <span className="truncate">
                    <span className="text-brand-800/80 dark:text-brand-200/80">{t("ips.inTable")}:</span> {server.name}
                  </span>
                  <span className="grid h-6 shrink-0 place-items-center gap-1 rounded-full bg-white/80 px-2 text-xs text-brand-800 shadow-xs dark:bg-white/10 dark:text-brand-100" aria-hidden="true">
                    <span className="flex items-center gap-1">
                      <Icon name="edit" size={12} />
                      {t("ips.rename")}
                    </span>
                  </span>
                </button>
              ) : (
                <Button variant="tinted" size="sm" onClick={() => { setName(""); setError(null); setMode("naming"); }}>
                  <Icon name="edit" size={14} />
                  {t("ips.nameIt")}
                </Button>
              )}
            </div>
          )}
        </div>

        {editingName && (
          <form onSubmit={save} className="mt-3 animate-pop-in rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.06] sm:p-3.5">
            <label htmlFor={`ip-name-${group.ip}`} className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-200">
              {mode === "renaming" ? t("ips.renameTitle") : t("servers.name")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id={`ip-name-${group.ip}`}
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
                placeholder={t("servers.namePlaceholder")}
                maxLength={64}
                enterKeyHint="done"
                aria-invalid={error ? true : undefined}
                className={`${inputClass} min-w-0 flex-1 ${error ? "ring-red-400 focus:ring-red-500" : ""}`}
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={cancel} disabled={busy} className="flex-1 sm:flex-none">{t("servers.cancel")}</Button>
                <Button type="submit" loading={busy} className="flex-1 sm:flex-none">{t("servers.save")}</Button>
              </div>
            </div>
            {mode === "renaming" && server && (
              <div className="mt-3 flex flex-col gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
                <Link to={`/servers?edit=${encodeURIComponent(server.id)}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300 sm:min-h-0">
                  {t("ips.editInServers")}
                  <Icon name="chevron-right" size={14} />
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setError(null); setMode("confirmRemove"); }}
                  disabled={busy}
                  className="self-start !text-red-600 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-500/10 sm:self-auto"
                >
                  <Icon name="trash" size={14} />
                  {t("ips.removeName")}
                </Button>
              </div>
            )}
          </form>
        )}

        {mode === "confirmRemove" && server && (
          <div role="alertdialog" aria-label={t("ips.removeName")} className="mt-3 animate-pop-in rounded-xl bg-red-50 p-3.5 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:ring-red-500/20">
            <p className="text-sm text-red-800 dark:text-red-200">{t("ips.removeConfirm", { name: server.name })}</p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setMode("renaming")} disabled={busy} className="flex-1 sm:flex-none">{t("servers.cancel")}</Button>
              <Button type="button" variant="danger" onClick={removeName} loading={busy} className="flex-1 sm:flex-none">{t("ips.confirmRemove")}</Button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {shown.map((r) => (
            <li key={`${r.domain}:${r.recordId}:${r.hostname}`} className="max-w-full truncate rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-700 dark:bg-white/[0.06] dark:text-slate-300">
              {r.hostname}
            </li>
          ))}
          {group.records.length > PREVIEW && (
            <li>
              <button type="button" onClick={() => setExpanded((v) => !v)} className="no-min-tap relative px-1.5 py-1 text-xs font-medium text-brand-700 before:absolute before:-inset-2 before:content-[''] hover:underline dark:text-brand-300">
                {expanded ? t("ips.showLess") : t("ips.showAll", { count: group.records.length })}
              </button>
            </li>
          )}
        </ul>
      </Card>
    </li>
  );
}
