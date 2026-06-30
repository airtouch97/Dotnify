import { useState, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { DnsRecord, ProviderType, RecordType } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Toggle } from "@/components/Toggle";
import { Select } from "@/components/Select";
import { SkeletonRow } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import hwLineData from "@/huawei_line.json";

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

// ---------------------------------------------------------------------------
// Huawei Cloud line data (loaded from local JSON, not API)
// ---------------------------------------------------------------------------

interface HwLineEntry {
  name: string;
  parent: string | null;
}

const HW_DATA = hwLineData as Record<string, HwLineEntry>;

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
  const { t } = useLang();
  const { zoneId } = useParams<{ zoneId: string }>();
  const [search] = useSearchParams();
  const providerId = search.get("providerId");
  const providerType = (search.get("providerType") ?? "cloudflare") as ProviderType;
  const zoneName = search.get("zoneName") ?? "";
  const showProxied = providerType === "cloudflare";
  const showLine = providerType === "huawei";

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
            {t("records.zone")} <span className="font-mono text-slate-700 dark:text-slate-300">{zoneId}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isValidating && !loading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              {t("records.updating")}
            </span>
          )}
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
                  <th className="px-4 py-2 font-medium">{t("records.ttl")}</th>
                  {showLine && <th className="px-4 py-2 font-medium">{t("records.line")}</th>}
                  {showProxied && <th className="px-4 py-2 font-medium">{t("records.proxied")}</th>}
                  <th className="px-4 py-2 text-right font-medium">{t("records.actions")}</th>
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
                  <th className="px-4 py-2 font-medium">{t("records.ttl")}</th>
                  {showLine && <th className="px-4 py-2 font-medium">{t("records.line")}</th>}
                  {showProxied && <th className="px-4 py-2 font-medium">{t("records.proxied")}</th>}
                  <th className="px-4 py-2 text-right font-medium">{t("records.actions")}</th>
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
                        {getLineName(r.line)}
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
  const { t } = useLang();
  const isEdit = !!record;
  const showProxied = providerType === "cloudflare";
  const showLine = providerType === "huawei";

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

  // Derive the final line ID from the cascade
  const line = useMemo(() => {
    if (lineCategory === "default") return "default_view";
    if (lineL4) return lineL4;
    if (lineL3) return lineL3;
    if (lineL2) return lineL2;
    return "default_view";
  }, [lineCategory, lineL2, lineL3, lineL4]);

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
  const [ttl, setTtl] = useState<number>(record?.ttl ?? 1);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || content === "") {
      setError(t("records.nameContentRequired"));
      return;
    }
    setBusy(true);
    const base = `/api/zones/${zoneId}/records`;
    const query = `?providerId=${providerId}&zoneName=${encodeURIComponent(zoneName)}`;
    const body: Record<string, unknown> = { type, name, content, ttl };
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
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("records.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={isEdit ? t("records.editRecord") : t("records.createRecord")}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Select
          label={t("records.type")}
          options={RECORD_TYPES.map((rt) => ({ value: rt, label: rt }))}
          value={type}
          onChange={(v) => setType(v as RecordType)}
        />
        <Input
          label={t("records.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("records.namePlaceholder")}
          required
        />
        <Input
          label={t("records.content")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("records.contentPlaceholder")}
          required
        />
        {showPriority && (
          <Input
            label={t("records.priority")}
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            hint={t("records.priorityHint")}
          />
        )}
        {showProxied ? (
          <Select
            label={t("records.ttl")}
            options={CF_TTL_OPTIONS.map((opt) => ({ value: opt.value, label: cfTtlLabel(opt, t("records.auto")) }))}
            value={ttl}
            onChange={(v) => setTtl(Number(v))}
            disabled={proxied}
          />
        ) : (
          <Input
            label={t("records.ttlSeconds")}
            type="number"
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
          />
        )}
        {showLine && (
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
                onChange={(v) => setLineL4(String(v))}
                disabled={lineCategory !== "carrier" || l4Options.length === 0}
              />
            </div>
          </div>
        )}
        {showProxied && (
          <div className="self-end pb-2">
            <Toggle
              checked={proxied}
              onChange={handleProxiedChange}
              label={t("records.proxied")}
              hint={t("records.proxiedHint")}
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
                onDone={onDone}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onDone}>
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

function DeleteButton({
  zoneId,
  zoneName,
  providerId,
  recordId,
  onDone,
}: {
  zoneId: string;
  zoneName: string;
  providerId: string;
  recordId: string;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
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
      <span className="inline-flex items-center gap-1">
        <Button variant="danger" onClick={remove} loading={busy}>
          {t("records.confirm")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          {t("records.cancel")}
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </span>
    );
  }

  return (
    <Button variant="danger" onClick={() => setConfirming(true)}>
      {t("records.delete")}
    </Button>
  );
}
