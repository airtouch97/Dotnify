import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { DnsRecord, ProviderType, RecordType, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Toggle } from "@/components/Toggle";
import { Select } from "@/components/Select";
import { SkeletonRow } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import hwLineData from "@/huawei_line.json";
import dpLineData from "@/dnspod_line.json";

const RECORD_TYPES: RecordType[] = [
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "NS",
  "SRV",
  "CAA",
  "PTR",
  "SOA",
  "SPF",
  "URI",
];
const TYPES_WITH_PRIORITY: ReadonlySet<RecordType> = new Set(["MX", "SRV"]);

// Content format validation
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z]{2,}$/;

function validateContent(type: RecordType, content: string): string | null {
  if (!content) return null;
  if (type === "A" && !IPV4_RE.test(content)) return "records.invalidIpv4";
  if (type === "AAAA" && !IPV6_RE.test(content)) return "records.invalidIpv6";
  if (type === "CNAME" && !DOMAIN_RE.test(content) && content !== "@") return "records.invalidCname";
  return null;
}

const CONTENT_PLACEHOLDER: Partial<Record<RecordType, string>> = {
  A: "e.g. 192.0.2.1",
  AAAA: "e.g. 2001:db8::1",
  CNAME: "e.g. example.com",
  TXT: "e.g. v=spf1 include:...",
  MX: "e.g. mail.example.com",
  NS: "e.g. ns1.example.com",
};

// ---------------------------------------------------------------------------
// Huawei Cloud line data (loaded from local JSON, not API)
// ---------------------------------------------------------------------------

interface HwLineEntry {
  name: string;
  parent: string | null;
}

const HW_DATA = hwLineData as Record<string, HwLineEntry>;

// DNSPod line translation: English name → Chinese name (from dnspod_line.json)
const DP_LINE_ZH = dpLineData as Record<string, string>;

// Build a children lookup map
const HW_CHILDREN = new Map<string | null, string[]>();
for (const [id, entry] of Object.entries(HW_DATA)) {
  if (!HW_CHILDREN.has(entry.parent)) HW_CHILDREN.set(entry.parent, []);
  HW_CHILDREN.get(entry.parent)!.push(id);
}

// Display name lookup
const HW_NAME_MAP = new Map<string, string>(
  Object.entries(HW_DATA).map(([id, entry]) => [id, entry.name]),
);

function getLineName(lineId: string | undefined): string {
  if (!lineId) return "Default";
  return HW_NAME_MAP.get(lineId) ?? lineId;
}

/** Strip the prefix before the last underscore for display in L3/L4 selects. */
function stripPrefix(name: string): string {
  const idx = name.lastIndexOf("_");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

// ---------------------------------------------------------------------------
// Cascading line selector logic
// ---------------------------------------------------------------------------

// Category IDs: top-level roots that aren't default
const CARRIER_IDS = ["Dianxin", "Yidong", "Liantong", "Jiaoyuwang", "Tietong", "Pengboshi"];

// For "地域解析" level 2, show CN + Abroad itself + Abroad's direct children + AQ (南极洲)
const REGION_L2_IDS = [
  "CN",
  ...getChildren("Abroad"), // AP, OA, EU, NA, LA, AF
  "AQ",     // 南极洲 (orphaned in data, parent=AQ)
  "Abroad", // 境外 (catch-all)
];

function getChildren(parentId: string): string[] {
  return HW_CHILDREN.get(parentId) ?? [];
}

// Resolve a line ID back into cascading selection levels.
// Returns [category, level2, level3, level4] (some may be empty string).
function resolveLineToLevels(lineId: string): [string, string, string, string] {
  if (lineId === "default_view") return ["default", "", "", ""];

  // Walk up the tree to find the path
  const path: string[] = [];
  let current: string | null = lineId;
  while (current && HW_DATA[current]) {
    path.unshift(current);
    current = HW_DATA[current].parent;
  }

  // The root (first in path) determines the category
  const root = path[0];
  if (CARRIER_IDS.includes(root)) {
    if (path.length === 1) return ["carrier", root, "", ""];
    if (path.length === 2) return ["carrier", root, path[1], ""];
    return ["carrier", root, path[1], path[2]];
  }

  // Region paths: CN and Abroad
  if (root === "CN") {
    // CN → region → area → province
    if (path.length === 1) return ["region", "CN", "", ""];
    return ["region", "CN", path[1], ""];
  }
  if (root === "Abroad") {
    // Abroad itself, or Abroad → continent → country
    if (path.length === 1) return ["region", "Abroad", "", ""];
    // The continent (AP, EU, NA, etc.) is the L2 in our cascade
    const continent = path[1];
    if (path.length === 2) return ["region", continent, "", ""];
    return ["region", continent, path[2], ""];
  }
  if (root === "AQ") {
    // AQ is directly a L2 option (南极洲)
    return ["region", "AQ", "", ""];
  }

  // Fallback
  return ["default", "", "", ""];
}

const CF_TTL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "__auto__" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
  { value: 900, label: "15 min" },
  { value: 1800, label: "30 min" },
  { value: 3600, label: "1 hour" },
  { value: 7200, label: "2 hours" },
  { value: 18000, label: "5 hours" },
  { value: 43200, label: "12 hours" },
  { value: 86400, label: "1 day" },
];

function cfTtlLabel(opt: { value: number; label: string }, autoLabel: string): string {
  return opt.label === "__auto__" ? autoLabel : opt.label;
}

function formatCfTtl(seconds: number, autoLabel: string): string {
  const opt = CF_TTL_OPTIONS.find((o) => o.value === seconds);
  return opt ? cfTtlLabel(opt, autoLabel) : `${seconds}s`;
}

export function Records() {
  const { t, lang } = useLang();
  const { zoneId } = useParams<{ zoneId: string }>();
  const location = useLocation();
  const state = location.state as { providerId?: string; providerType?: ProviderType; zoneName?: string } | null;

  // Fallback: if state is missing (direct URL / refresh), fetch zone info from API
  const { data: zonesData } = useFetch<{ zones: ZoneWithProvider[] }>(!state?.providerId && zoneId ? "/api/zones" : null, { cacheTtl: 604800 });
  const fallbackZone = zonesData?.zones.find((z) => z.id === zoneId);

  const providerId = state?.providerId ?? fallbackZone?.providerId ?? null;
  const providerType = (state?.providerType ?? fallbackZone?.providerType ?? "cloudflare") as ProviderType;
  const zoneName = state?.zoneName ?? fallbackZone?.name ?? "";
  const showProxied = providerType === "cloudflare";
  const showLine = providerType === "huawei" || providerType === "dnspod";

  useEffect(() => {
    document.title = zoneName
      ? `${zoneName} | Dotnify`
      : `${t("title.records")} | Dotnify`;
  }, [zoneName, t]);

  // DNSPod line data for display in the table
  const dpLinesPath = providerType === "dnspod" && zoneId && providerId
    ? `/api/zones/${zoneId}/lines?providerId=${providerId}&providerType=dnspod&zoneName=${encodeURIComponent(zoneName)}`
    : null;
  const { data: dpLinesData } = useFetch<{ lineId: string; name: string }[]>(dpLinesPath);
  const dpLineNameMap = useMemo(() => {
    if (!dpLinesData) return new Map<string, string>();
    return new Map(dpLinesData.map((l) => [l.lineId, l.name]));
  }, [dpLinesData]);

  function displayLineName(lineId: string | undefined): string {
    if (!lineId) return "Default";
    if (providerType === "dnspod") {
      const name = dpLineNameMap.get(lineId) ?? lineId;
      return lang === "zh-CN" ? (DP_LINE_ZH[name] ?? name) : name;
    }
    return getLineName(lineId);
  }

  const path =
    zoneId && providerId
      ? `/api/zones/${zoneId}/records?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}`
      : null;
  const {
    data: records,
    loading,
    error,
    isValidating,
    refetch,
  } = useFetch<DnsRecord[]>(path);

  const [editing, setEditing] = useState<DnsRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  if (!zoneId || !providerId) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title={t("records.missingParams")}
          description={t("records.missingParamsDesc")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/domains" className="text-sm text-brand-600 hover:underline">
            {t("records.backToDomains")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t("records.dnsRecords")}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {t("records.zone")} <span className="font-mono text-slate-700 dark:text-slate-300">{zoneName || zoneId}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isValidating && !loading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              {t("records.updating")}
            </span>
          )}
          <Button variant="ghost" onClick={() => setShowExport(true)}>
            {t("records.export")}
          </Button>
          <Button variant="ghost" onClick={() => setShowImport(true)}>
            {t("records.import")}
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setCreating((v) => !v);
            }}
            variant={creating ? "secondary" : "primary"}
          >
            {creating ? t("records.cancel") : t("records.addRecord")}
          </Button>
        </div>
      </div>

      {creating && (
        <RecordForm
          zoneId={zoneId}
          zoneName={zoneName}
          providerId={providerId}
          providerType={providerType}
          onDone={() => {
            setCreating(false);
            void refetch();
          }}
        />
      )}

      {showExport && (
        <ExportModal
          zoneId={zoneId}
          zoneName={zoneName}
          providerId={providerId}
          onClose={() => setShowExport(false)}
        />
      )}

      {showImport && (
        <ImportModal
          zoneId={zoneId}
          zoneName={zoneName}
          providerId={providerId}
          onClose={() => setShowImport(false)}
          onDone={() => void refetch()}
        />
      )}

      {editing && (
        <RecordForm
          zoneId={zoneId}
          zoneName={zoneName}
          providerId={providerId}
          providerType={providerType}
          record={editing}
          onDone={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}

      {loading ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2 font-medium">{t("records.type")}</th>
                  <th className="px-4 py-2 font-medium">{t("records.name")}</th>
                  <th className="px-4 py-2 font-medium">{t("records.content")}</th>
                  <th className="px-4 py-2 font-medium w-24">{t("records.ttl")}</th>
                  {showLine && <th className="px-4 py-2 font-medium">{t("records.line")}</th>}
                  {showProxied && <th className="px-4 py-2 font-medium">{t("records.proxied")}</th>}
                  <th className="px-4 py-2 text-right font-medium w-28">{t("records.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={4 + (showLine ? 1 : 0) + (showProxied ? 1 : 0) + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void refetch()}
          >
            {t("records.retry")}
          </Button>
        </Card>
      ) : !records || records.length === 0 ? (
        <EmptyState
          title={t("records.noRecords")}
          description={t("records.noRecordsDesc")}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2 font-medium">{t("records.type")}</th>
                  <th className="px-4 py-2 font-medium">{t("records.name")}</th>
                  <th className="px-4 py-2 font-medium">{t("records.content")}</th>
                  <th className="px-4 py-2 font-medium w-24">{t("records.ttl")}</th>
                  {showLine && <th className="px-4 py-2 font-medium">{t("records.line")}</th>}
                  {showProxied && <th className="px-4 py-2 font-medium">{t("records.proxied")}</th>}
                  <th className="px-4 py-2 text-right font-medium w-28">{t("records.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-b-0 align-top dark:border-slate-700"
                  >
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-900 dark:text-slate-100">
                      {r.name}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-700 break-all dark:text-slate-300">
                      {r.content}
                      {r.priority !== undefined && r.priority !== null && (
                        <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                          (pri {r.priority})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      {showProxied ? formatCfTtl(r.ttl, t("records.auto")) : r.ttl}
                    </td>
                    {showLine && (
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {displayLineName(r.line)}
                      </td>
                    )}
                    {showProxied && (
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {r.proxied ? t("records.yes") : t("records.no")}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right align-middle">
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          className="px-2 py-[0.2rem] text-xs leading-none"
                          onClick={() => setEditing(r)}
                        >
                          {t("records.edit")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function RecordForm({
  zoneId,
  zoneName,
  providerId,
  providerType,
  record,
  onDone,
}: {
  zoneId: string;
  zoneName: string;
  providerId: string;
  providerType: ProviderType;
  record?: DnsRecord;
  onDone: () => void;
}) {
  const { t, lang } = useLang();
  const isEdit = !!record;
  const showProxied = providerType === "cloudflare";
  const showLine = providerType === "huawei" || providerType === "dnspod";

  // DNSPod line data (fetched from API)
  const dpLinesPath = providerType === "dnspod" && zoneId && providerId
    ? `/api/zones/${zoneId}/lines?providerId=${providerId}&providerType=dnspod&zoneName=${encodeURIComponent(zoneName)}`
    : null;
  const { data: dpLinesData } = useFetch<{ lineId: string; name: string; parent: string | null }[]>(dpLinesPath);

  // Build DNSPod line lookup maps
  const dpLineMap = useMemo(() => {
    if (providerType !== "dnspod" || !dpLinesData) return { byId: new Map<string, string>(), children: new Map<string | null, string[]>() };
    const byId = new Map<string, string>();
    const children = new Map<string | null, string[]>();
    for (const line of dpLinesData) {
      byId.set(line.lineId, line.name);
      if (!children.has(line.parent)) children.set(line.parent, []);
      children.get(line.parent)!.push(line.lineId);
    }
    return { byId, children };
  }, [providerType, dpLinesData]);

  // DNSPod line state
  const [dpLineId, setDpLineId] = useState<string>(record?.line ?? "0");

  // Cascading line state
  const [lineCategory, setLineCategory] = useState<string>(() => {
    if (!record?.line) return "default";
    return resolveLineToLevels(record.line)[0];
  });
  const [lineL2, setLineL2] = useState<string>(() => {
    if (!record?.line) return "";
    return resolveLineToLevels(record.line)[1];
  });
  const [lineL3, setLineL3] = useState<string>(() => {
    if (!record?.line) return "";
    return resolveLineToLevels(record.line)[2];
  });
  const [lineL4, setLineL4] = useState<string>(() => {
    if (!record?.line) return "";
    return resolveLineToLevels(record.line)[3];
  });

  // Derive the final line ID from the cascade (Huawei) or directly (DNSPod)
  const line = useMemo(() => {
    if (providerType === "dnspod") return dpLineId;
    if (lineCategory === "default") return "default_view";
    if (lineL4) return lineL4;
    if (lineL3) return lineL3;
    if (lineL2) return lineL2;
    return "default_view";
  }, [providerType, dpLineId, lineCategory, lineL2, lineL3, lineL4]);

  // Level 2 options
  const l2Options = useMemo(() => {
    if (lineCategory === "carrier") return CARRIER_IDS;
    if (lineCategory === "region") return REGION_L2_IDS;
    return [];
  }, [lineCategory]);

  // Level 3 options
  const l3Options = useMemo(() => {
    if (!lineL2) return [];
    return getChildren(lineL2);
  }, [lineL2]);

  // Level 4 options (only for carriers with area sub-items)
  const l4Options = useMemo(() => {
    if (lineCategory !== "carrier" || !lineL3) return [];
    return getChildren(lineL3);
  }, [lineCategory, lineL3]);

  const [type, setType] = useState<RecordType>(record?.type ?? "A");
  const [name, setName] = useState(record?.name ?? "");
  const [content, setContent] = useState(record?.content ?? "");
  const [ttl, setTtl] = useState<number>(record?.ttl ?? (providerType === "dnspod" ? 600 : 1));
  const [proxied, setProxied] = useState<boolean>(record?.proxied ?? false);

  // When proxied changes, force TTL to 1 (auto)
  function handleProxiedChange(val: boolean) {
    setProxied(val);
    if (val) setTtl(1);
  }
  const [priority, setPriority] = useState<string>(
    record?.priority !== undefined && record?.priority !== null
      ? String(record.priority)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showPriority = TYPES_WITH_PRIORITY.has(type);

  // Content validation hint
  const contentError = useMemo(() => {
    const key = validateContent(type, content);
    return key ? t(key) : null;
  }, [type, content, t]);

  // Unsaved changes tracking
  const dirty = useRef(false);
  const trackDirty = useCallback(() => { dirty.current = true; }, []);

  // beforeunload guard
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (dirty.current) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || content === "") {
      setError(t("records.nameContentRequired"));
      return;
    }
    // Content format validation
    const contentKey = validateContent(type, content);
    if (contentKey) {
      setError(t(contentKey));
      return;
    }
    // Priority required for MX/SRV
    if (showPriority && priority === "") {
      setError(t("records.priorityRequired"));
      return;
    }
    setBusy(true);
    const base = `/api/zones/${zoneId}/records`;
    const query = `?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}`;
    const body: Record<string, unknown> = { type, name, content, ttl: providerType === "dnspod" && ttl < 600 ? 600 : ttl };
    if (showProxied) body.proxied = proxied;
    if (showLine) body.line = line;
    if (showPriority && priority !== "") body.priority = Number(priority);
    try {
      if (isEdit && record) {
        await apiFetch(`${base}/${record.id}${query}`, {
          method: "PATCH",
          body,
        });
      } else {
        await apiFetch(`${base}${query}`, { method: "POST", body });
      }
      dirty.current = false;
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("records.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (dirty.current && !window.confirm(`${t("records.unsavedDesc")}`)) return;
    dirty.current = false;
    onDone();
  }

  return (
    <Card title={isEdit ? t("records.editRecord") : t("records.createRecord")}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Select
          label={t("records.type")}
          options={RECORD_TYPES.map((rt) => ({ value: rt, label: rt }))}
          value={type}
          onChange={(v) => { setType(v as RecordType); trackDirty(); }}
          disabled={isEdit}
        />
        {isEdit && (
          <p className="self-end text-xs text-slate-400 dark:text-slate-500">{t("records.typeReadOnly")}</p>
        )}
        <Input
          label={t("records.name")}
          value={name}
          onChange={(e) => { setName(e.target.value); trackDirty(); }}
          placeholder={t("records.namePlaceholder")}
          required
        />
        <Input
          label={t("records.content")}
          value={content}
          onChange={(e) => { setContent(e.target.value); trackDirty(); }}
          placeholder={CONTENT_PLACEHOLDER[type] ?? t("records.contentPlaceholder")}
          error={contentError}
          required
        />
        {showPriority && (
          <Input
            label={t("records.priority")}
            type="number"
            value={priority}
            onChange={(e) => { setPriority(e.target.value); trackDirty(); }}
            hint={t("records.priorityHint")}
          />
        )}
        {showProxied ? (
          <Select
            label={t("records.ttl")}
            options={CF_TTL_OPTIONS.map((opt) => ({ value: opt.value, label: cfTtlLabel(opt, t("records.auto")) }))}
            value={ttl}
            onChange={(v) => { setTtl(Number(v)); trackDirty(); }}
            disabled={proxied}
          />
        ) : (
          <Input
            label={t("records.ttlSeconds")}
            type="number"
            value={ttl}
            onChange={(e) => { setTtl(Number(e.target.value)); trackDirty(); }}
          />
        )}
        {showLine && providerType === "dnspod" && (
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("records.line")}</label>
            <DnsLineSelector
              lineId={dpLineId}
              lines={dpLinesData ?? []}
              lineMap={dpLineMap}
              onChange={(id) => { setDpLineId(id); trackDirty(); }}
              lang={lang}
            />
          </div>
        )}
        {showLine && providerType === "huawei" && (
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("records.line")}</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {/* Level 1: Category */}
              <Select
                options={[
                  { value: "default", label: t("records.default") },
                  { value: "carrier", label: t("records.carrier") },
                  { value: "region", label: t("records.region") },
                ]}
                value={lineCategory}
                onChange={(v) => {
                  setLineCategory(String(v));
                  setLineL2("");
                  setLineL3("");
                  setLineL4("");
                  trackDirty();
                }}
              />

              {/* Level 2: Group */}
              <Select
                options={[
                  { value: "", label: lineCategory === "default" ? t("records.default") : t("records.selectDot") },
                  ...l2Options.map((id) => ({ value: id, label: HW_DATA[id].name })),
                ]}
                value={lineL2}
                onChange={(v) => {
                  setLineL2(String(v));
                  setLineL3("");
                  setLineL4("");
                  trackDirty();
                }}
                disabled={lineCategory === "default"}
              />

              {/* Level 3: Sub-group */}
              <Select
                options={[
                  { value: "", label: lineCategory === "default" || l3Options.length === 0 ? t("records.default") : t("records.selectDot") },
                  ...l3Options.map((id) => ({ value: id, label: stripPrefix(HW_DATA[id].name) })),
                ]}
                value={lineL3}
                onChange={(v) => {
                  setLineL3(String(v));
                  setLineL4("");
                  trackDirty();
                }}
                disabled={lineCategory === "default" || l3Options.length === 0}
              />

              {/* Level 4: Leaf (carrier only) */}
              <Select
                options={[
                  { value: "", label: lineCategory !== "carrier" || l4Options.length === 0 ? t("records.default") : t("records.selectDot") },
                  ...l4Options.map((id) => ({ value: id, label: stripPrefix(HW_DATA[id].name) })),
                ]}
                value={lineL4}
                onChange={(v) => { setLineL4(String(v)); trackDirty(); }}
                disabled={lineCategory !== "carrier" || l4Options.length === 0}
              />
            </div>
          </div>
        )}
        {showProxied && (
          <div className="self-end pb-2">
            <Toggle
              checked={proxied}
              onChange={(v) => { handleProxiedChange(v); trackDirty(); }}
              label={t("records.proxied")}
              hint={t("records.proxiedHint")}
              onLabel={t("records.on")}
              offLabel={t("records.off")}
            />
          </div>
        )}
        {error && <p className="text-xs text-red-600 md:col-span-2">{error}</p>}
        <div className="flex items-center justify-between gap-2 md:col-span-2">
          <div>
            {isEdit && record && (
              <DeleteButton
                zoneId={zoneId}
                zoneName={zoneName}
                providerId={providerId}
                recordId={record.id}
                recordName={record.name}
                onDone={onDone}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={handleCancel}>
              {t("records.cancel")}
            </Button>
            <Button type="submit" loading={busy}>
              {isEdit ? t("records.save") : t("records.create")}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/**
 * DNSPod line selector — simplified 2-level cascade.
 * Level 1: top-level groups (parent=null), Level 2: children of selected group.
 */
function DnsLineSelector({
  lineId,
  lines,
  lineMap,
  onChange,
  lang,
}: {
  lineId: string;
  lines: { lineId: string; name: string; parent: string | null }[];
  lineMap: { byId: Map<string, string>; children: Map<string | null, string[]> };
  onChange: (id: string) => void;
  lang: string;
}) {
  // Find the parent of the current lineId
  const currentLine = lines.find((l) => l.lineId === lineId);
  const topLevelIds = lineMap.children.get(null) ?? [];

  // Find the default line id (parent=null, usually "0")
  const defaultId = topLevelIds.length > 0 ? topLevelIds[0] : "0";

  // Determine the selected top-level group
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() => {
    if (!currentLine) return defaultId;
    // Walk up to find top-level parent
    let parent = currentLine.parent;
    while (parent !== null) {
      const parentLine = lines.find((l) => l.lineId === parent);
      if (!parentLine || parentLine.parent === null) break;
      parent = parentLine.parent;
    }
    return parent ?? defaultId;
  });

  const childIds = lineMap.children.get(selectedGroup) ?? [];

  // Check if current lineId is a top-level item
  const isTopLevel = topLevelIds.includes(lineId);

  function handleGroupChange(group: string | number) {
    const val = String(group);
    setSelectedGroup(val);
    onChange(val);
  }

  function handleChildChange(id: string | number) {
    onChange(String(id));
  }

  function lineLabel(id: string): string {
    const name = lineMap.byId.get(id) ?? id;
    return lang === "zh-CN" ? (DP_LINE_ZH[name] ?? name) : name;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Level 1: Top-level groups */}
      <Select
        options={topLevelIds.map((id) => ({ value: id, label: lineLabel(id) }))}
        value={selectedGroup ?? defaultId}
        onChange={handleGroupChange}
      />

      {/* Level 2: Children of selected group */}
      <Select
        options={[
          { value: selectedGroup ?? defaultId, label: lineLabel(selectedGroup ?? defaultId) },
          ...childIds.map((id) => ({ value: id, label: lineLabel(id) })),
        ]}
        value={isTopLevel ? (selectedGroup ?? defaultId) : lineId}
        onChange={handleChildChange}
        disabled={childIds.length === 0}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export modal
// ---------------------------------------------------------------------------

function ExportModal({
  zoneId,
  zoneName,
  providerId,
  onClose,
}: {
  zoneId: string;
  zoneName: string;
  providerId: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [format, setFormat] = useState<"json" | "zonefile" | "csv">("json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const FORMATS: { value: "json" | "zonefile" | "csv"; label: string; desc: string }[] = [
    { value: "json", label: t("records.formatJson"), desc: t("records.formatJsonDesc") },
    { value: "zonefile", label: t("records.formatZonefile"), desc: t("records.formatZonefileDesc") },
    { value: "csv", label: t("records.formatCsv"), desc: t("records.formatCsvDesc") },
  ];

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const query = `?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}&format=${format}`;
      const res = await apiFetch<Response>(`/api/zones/${zoneId}/export${query}`, { raw: true });

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?(.+?)"?$/);
      const filename = match?.[1] ?? `${zoneName}.${format === "zonefile" ? "txt" : format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("records.exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("records.export")}>
      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          {FORMATS.map((f) => (
            <label
              key={f.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                format === f.value
                  ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500"
              }`}
            >
              <input
                type="radio"
                name="export-format"
                value={f.value}
                checked={format === f.value}
                onChange={() => setFormat(f.value)}
                className="mt-0.5 accent-brand-600"
              />
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{f.label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("records.cancel")}</Button>
          <Button onClick={handleExport} loading={busy}>{t("records.export")}</Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

interface PreviewRecord {
  type: string;
  name: string;
  content: string;
  ttl: number;
}

function ImportModal({
  zoneId,
  zoneName,
  providerId,
  onClose,
  onDone,
}: {
  zoneId: string;
  zoneName: string;
  providerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [format, setFormat] = useState<"json" | "zonefile" | "csv">("json");
  const [content, setContent] = useState("");
  const [strategy, setStrategy] = useState<"skip" | "overwrite" | "append">("skip");
  const [preview, setPreview] = useState<PreviewRecord[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; updated: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Parse content for preview when it changes
  useEffect(() => {
    if (!content) {
      setPreview([]);
      setParseErrors([]);
      return;
    }
    // Client-side preview parse (simple, doesn't need to match server exactly)
    try {
      if (format === "json") {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed) ? parsed : parsed.records;
        if (Array.isArray(arr)) {
          const records = arr.slice(0, 20).map((r: Record<string, unknown>) => ({
            type: String(r.type ?? ""),
            name: String(r.name ?? ""),
            content: String(r.content ?? ""),
            ttl: typeof r.ttl === "number" ? r.ttl : 300,
          }));
          setPreview(records);
          setParseErrors([]);
        } else {
          setPreview([]);
          setParseErrors(["Invalid JSON structure"]);
        }
      } else if (format === "csv") {
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length > 1) {
          const header = lines[0].toLowerCase().split(",");
          const typeIdx = header.indexOf("type");
          const nameIdx = header.indexOf("name");
          const contentIdx = header.indexOf("content");
          const ttlIdx = header.indexOf("ttl");
          if (typeIdx < 0 || nameIdx < 0 || contentIdx < 0) {
            setPreview([]);
            setParseErrors(["CSV must have type, name, content columns"]);
            return;
          }
          const records = lines.slice(1, 21).map((line) => {
            const cols = line.split(",");
            return {
              type: (cols[typeIdx] ?? "").trim().toUpperCase(),
              name: (cols[nameIdx] ?? "").trim(),
              content: (cols[contentIdx] ?? "").trim(),
              ttl: ttlIdx >= 0 ? parseInt(cols[ttlIdx], 10) || 300 : 300,
            };
          });
          setPreview(records);
          setParseErrors([]);
        } else {
          setPreview([]);
          setParseErrors([]);
        }
      } else {
        // Zone file — basic preview, just show non-comment lines
        const lines = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith(";") && !l.trim().startsWith("$"));
        const records = lines.slice(0, 20).map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            type: parts.length >= 4 ? parts[3] : "",
            name: parts[0] || "",
            content: parts.slice(4).join(" ") || "",
            ttl: parts.length >= 2 ? parseInt(parts[1], 10) || 300 : 300,
          };
        });
        setPreview(records);
        setParseErrors([]);
      }
    } catch {
      setPreview([]);
      setParseErrors(["Parse error"]);
    }
  }, [content, format]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    // Auto-detect format from extension
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") setFormat("csv");
    else if (ext === "txt" || ext === "zone") setFormat("zonefile");
    else setFormat("json");

    const reader = new FileReader();
    reader.onload = () => {
      setContent(reader.result as string);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ created: number; skipped: number; updated: number; errors: string[] }>(
        `/api/zones/${zoneId}/import?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}`,
        {
          method: "POST",
          body: { format, content, strategy },
        },
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("records.importFailed"));
    } finally {
      setBusy(false);
    }
  }

  // Show result after import
  if (result) {
    return (
      <Card title={t("records.import")}>
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {t("records.importResult", { created: result.created, skipped: result.skipped, updated: result.updated })}
          </p>
          {result.errors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-600">{t("records.importErrors")}:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-red-500">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              {t("records.close")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t("records.import")}>
      <div className="space-y-4">
        {/* Format selector */}
        <Select
          label={t("records.importFormat")}
          options={[
            { value: "json", label: t("records.formatJson") },
            { value: "zonefile", label: t("records.formatZonefile") },
            { value: "csv", label: t("records.formatCsv") },
          ]}
          value={format}
          onChange={(v) => setFormat(v as "json" | "zonefile" | "csv")}
        />

        {/* File upload / paste area */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("records.pasteOrUpload")}
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.csv,.zone"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-400 dark:hover:bg-brand-900/20 dark:hover:text-brand-400"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            {fileName ?? "Choose file…"}
          </button>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            placeholder={format === "json" ? '[{ "type": "A", "name": "www", "content": "1.2.3.4", "ttl": 300 }]' : format === "csv" ? "type,name,content,ttl\nA,www,1.2.3.4,300" : "www  300  IN  A  1.2.3.4"}
          />
        </div>

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
              {t("records.parseErrors", { count: parseErrors.length })}
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-yellow-600 dark:text-yellow-500">
              {parseErrors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              {t("records.importPreviewCount", { count: preview.length })}
            </p>
            <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Content</th>
                    <th className="px-2 py-1">TTL</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0 dark:border-slate-700">
                      <td className="px-2 py-1 font-mono">{r.type}</td>
                      <td className="px-2 py-1 font-mono">{r.name}</td>
                      <td className="max-w-[200px] truncate px-2 py-1 font-mono">{r.content}</td>
                      <td className="px-2 py-1">{r.ttl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Conflict strategy */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("records.conflictStrategy")}
          </label>
          {([
            { value: "skip", label: t("records.skip"), desc: t("records.skipDesc") },
            { value: "overwrite", label: t("records.overwrite"), desc: t("records.overwriteDesc") },
            { value: "append", label: t("records.append"), desc: t("records.appendDesc") },
          ] as const).map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                strategy === s.value
                  ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500"
              }`}
            >
              <input
                type="radio"
                name="conflict-strategy"
                value={s.value}
                checked={strategy === s.value}
                onChange={() => setStrategy(s.value)}
                className="mt-0.5 accent-brand-600"
              />
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{s.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("records.cancel")}</Button>
          <Button
            onClick={handleImport}
            loading={busy}
            disabled={!content.trim()}
          >
            {t("records.startImport")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DeleteButton({
  zoneId,
  zoneName,
  providerId,
  recordId,
  recordName,
  onDone,
}: {
  zoneId: string;
  zoneName: string;
  providerId: string;
  recordId: string;
  recordName: string;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameMatch = confirmInput === recordName;

  async function remove() {
    if (!nameMatch) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        `/api/zones/${zoneId}/records/${recordId}?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}`,
        { method: "DELETE" },
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("records.deleteFailed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t("records.deleteConfirmName")}: <span className="font-mono font-medium">{recordName}</span>
        </p>
        <Input
          label={t("records.name")}
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder={recordName}
          inputRef={inputRef}
        />
        <span className="inline-flex items-center gap-1">
          <Button variant="danger" onClick={remove} loading={busy} disabled={!nameMatch}>
            {t("records.confirm")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setConfirming(false); setConfirmInput(""); }}
            disabled={busy}
          >
            {t("records.cancel")}
          </Button>
        </span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <Button variant="danger" onClick={() => setConfirming(true)}>
      {t("records.delete")}
    </Button>
  );
}
