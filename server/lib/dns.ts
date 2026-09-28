/**
 * Provider-agnostic DNS helpers shared by the REST routes (server/routes/zones.ts)
 * the server-binding helpers (server/lib/binding.ts) and the MCP endpoint (server/routes/mcp.ts).
 *
 * Every function here dispatches on `provider.type` to the matching provider
 * client (Cloudflare / Huawei Cloud / Tencent Cloud DNSPod / Alibaba Cloud) and
 * normalizes results into the common `DnsRecord` / `Zone` shapes.
 */
import { redis, KEYS } from "./redis.js";
import { cfFetch } from "./cloudflare.js";
import {
  listZones as hwListZones,
  listRecordSets,
  createRecordSet as hwCreateRecordSet,
  updateRecordSet as hwUpdateRecordSet,
  deleteRecordSet as hwDeleteRecordSet,
  stripHost,
} from "./huawei.js";
import {
  listZones as dpListZones,
  listRecords as dpListRecords,
  createRecord as dpCreateRecord,
  updateRecord as dpUpdateRecord,
  deleteRecord as dpDeleteRecord,
  listLines as dpListLines,
} from "./dnspod.js";
import type { DpRecord } from "./dnspod.js";
import {
  listZones as aliyunListZones,
  listRecords as aliyunListRecords,
  createRecord as aliyunCreateRecord,
  updateRecord as aliyunUpdateRecord,
  deleteRecord as aliyunDeleteRecord,
} from "./aliyun.js";
import type { AliyunRecord } from "./aliyun.js";
import type { ImportRecord } from "./import.js";
import type { Provider, Zone, DnsRecord } from "./types.js";
import { withChangeLog, snapshot, type DnsChange } from "./changelog.js";

export interface CfZone {
  id: string;
  name: string;
  status: string;
}

export interface ZoneWithProvider extends Zone {
  providerId: string;
  providerName: string;
  providerType: Provider["type"];
}


export async function findProvider(providerId: string | undefined): Promise<Provider | null> {
  if (!providerId) return null;
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const providers = Array.isArray(raw) ? raw : [];
  return providers.find((p) => p.id === providerId) ?? null;
}


export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  comment?: string | { content?: string };
}

export function normalizeCf(r: CfRecord): DnsRecord {
  const comment =
    typeof r.comment === "string"
      ? r.comment
      : r.comment && typeof r.comment === "object" && "content" in r.comment
        ? r.comment.content ?? ""
        : undefined;
  return {
    id: r.id,
    type: r.type as DnsRecord["type"],
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied,
    priority: r.priority,
    comment,
  };
}

export function normalizeHw(rs: { id: string; name: string; type: string; ttl: number; records: string[]; line?: string }, zoneName: string): DnsRecord {
  return {
    id: rs.id,
    type: rs.type as DnsRecord["type"],
    name: stripHost(rs.name, zoneName),
    content: rs.records.length > 1 ? rs.records.join(", ") : (rs.records[0] ?? ""),
    ttl: rs.ttl,
    line: rs.line,
  };
}

export function normalizeDp(r: DpRecord): DnsRecord {
  return {
    id: r.id,
    type: r.type as DnsRecord["type"],
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    line: r.line,
    priority: r.type === "MX" ? r.mx : undefined,
    status: r.status === "ENABLE" ? "enable" : "disable",
    weight: r.weight || undefined,
  };
}

export function normalizeAliyun(r: AliyunRecord): DnsRecord {
  return {
    id: r.id,
    type: r.type as DnsRecord["type"],
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    line: r.line,
    priority: r.type === "MX" ? r.mx : undefined,
    status: r.status === "ENABLE" ? "enable" : "disable",
    weight: r.weight || undefined,
    comment: r.remark,
  };
}

export async function resolveDpLineName(secretId: string, secretKey: string, domain: string, lineId: string | undefined): Promise<string> {
  if (!lineId || lineId === "0") return "Default";
  try {
    const lines = await dpListLines(secretId, secretKey, domain);
    const found = lines.find((l) => l.lineId === lineId);
    return found?.name ?? lineId;
  } catch {
    return lineId;
  }
}


/**
 * Normalize a record name for comparison purposes.
 * Strips the zone suffix and converts apex names to "@",
 * matching the same logic used by the import parsers.
 */
export function normalizeRecordName(name: string, zoneName: string): string {
  let n = name.trim();
  if (n.endsWith(".")) n = n.slice(0, -1);
  if (n === "@") return "@";
  if (n === zoneName) return "@";
  const suffix = `.${zoneName}`;
  if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  return n;
}

/**
 * Fetch ALL Cloudflare DNS records for a zone, handling pagination.
 * CF API limits per_page to 100, so we paginate through all pages.
 */
export async function fetchAllCfRecords(apiKey: string, zoneId: string): Promise<DnsRecord[]> {
  const all: DnsRecord[] = [];
  let page = 1;
  const perPage = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await cfFetch<CfRecord[]>(
      apiKey,
      `/zones/${zoneId}/dns_records`,
      { query: { per_page: perPage, page } }
    );
    const batch = (Array.isArray(result) ? result : []).map(normalizeCf);
    all.push(...batch);
    if (batch.length < perPage) break; // last page
    page++;
  }
  return all;
}

/** Create a single DNS record (reuses provider dispatch logic). No logging — use createNewRecord. */
async function rawCreateRecord(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  rec: ImportRecord,
): Promise<DnsRecord> {
  if (provider.type === "cloudflare") {
    const isProxied = rec.proxied === true;
    const payload: Record<string, unknown> = {
      type: rec.type,
      name: rec.name,
      content: rec.content,
      ttl: isProxied ? 1 : (rec.ttl ?? 1),
    };
    if (rec.proxied !== undefined) payload.proxied = rec.proxied;
    if (rec.priority !== undefined) payload.priority = rec.priority;
    if (rec.comment) payload.comment = rec.comment;

    const result = await cfFetch<CfRecord>(provider.apiKey, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: payload,
    });
    return normalizeCf(result);
  } else if (provider.type === "huawei") {
    const records = rec.content.includes(", ")
      ? rec.content.split(", ")
      : [rec.content];
    const rs = await hwCreateRecordSet(
      provider.apiAccessKey ?? "",
      provider.apiSecretKey ?? "",
      provider.region,
      zoneId,
      zoneName,
      {
        name: rec.name,
        type: rec.type,
        ttl: rec.ttl ?? 300,
        records,
        line: rec.line,
      }
    );
    return normalizeHw(rs, zoneName);
  } else if (provider.type === "dnspod") {
    const ak = provider.apiAccessKey ?? "";
    const sk = provider.apiSecretKey ?? "";
    const lineName = await resolveDpLineName(ak, sk, zoneName, rec.line);
    const dpTtl = Math.max(rec.ttl || 600, 600);
    const r = await dpCreateRecord(ak, sk, zoneName, {
      name: rec.name,
      type: rec.type,
      content: rec.content,
      line: rec.line,
      lineName,
      ttl: dpTtl,
      mx: rec.priority,
      weight: rec.weight,
    });
    return normalizeDp(r);
  } else if (provider.type === "aliyun") {
    const ak = provider.apiAccessKey ?? "";
    const sk = provider.apiSecretKey ?? "";
    const aliyunTtl = Math.max(rec.ttl || 600, 600);
    const r = await aliyunCreateRecord(ak, sk, zoneName, {
      name: rec.name,
      type: rec.type,
      content: rec.content,
      line: rec.line,
      ttl: aliyunTtl,
      mx: rec.priority,
      weight: rec.weight,
    });
    return normalizeAliyun(r);
  } else {
    throw new Error(`Unsupported provider type: ${provider.type}`);
  }
}

/** Update an existing DNS record. No logging — use updateExistingRecord. Returns the updated record when the provider returns it. */
async function rawUpdateRecord(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  recordId: string,
  rec: ImportRecord,
): Promise<DnsRecord | null> {
  if (provider.type === "cloudflare") {
    const isProxied = rec.proxied === true;
    const payload: Record<string, unknown> = {
      type: rec.type,
      name: rec.name,
      content: rec.content,
    };
    if (isProxied) {
      payload.ttl = 1;
    } else if (rec.ttl !== undefined) {
      payload.ttl = rec.ttl;
    }
    if (rec.proxied !== undefined) payload.proxied = rec.proxied;
    if (rec.priority !== undefined) payload.priority = rec.priority;
    if (rec.comment !== undefined) payload.comment = rec.comment;

    const result = await cfFetch<CfRecord>(provider.apiKey, `/zones/${zoneId}/dns_records/${recordId}`, {
      method: "PATCH",
      body: payload,
    });
    return result && typeof result === "object" && "id" in result ? normalizeCf(result) : null;
  } else if (provider.type === "huawei") {
    const ak = provider.apiAccessKey ?? "";
    const sk = provider.apiSecretKey ?? "";
    const reg = provider.region;

    const existingSets = await listRecordSets(ak, sk, reg, zoneId);
    const existing = existingSets.find((rs) => rs.id === recordId);
    if (!existing) throw new Error("Record not found");

    const records = rec.content.includes(", ")
      ? rec.content.split(", ")
      : [rec.content];

    await hwUpdateRecordSet(ak, sk, reg, zoneId, recordId, zoneName, {
      name: rec.name ?? existing.name,
      type: rec.type ?? existing.type,
      ttl: rec.ttl ?? existing.ttl,
      records,
      line: rec.line ?? existing.line,
    });
  } else if (provider.type === "dnspod") {
    const ak = provider.apiAccessKey ?? "";
    const sk = provider.apiSecretKey ?? "";

    const existingRecords = await dpListRecords(ak, sk, zoneName);
    const existing = existingRecords.find((r) => r.id === recordId);
    if (!existing) throw new Error("Record not found");

    const resolvedLine = rec.line ?? existing.line;
    const lineName = await resolveDpLineName(ak, sk, zoneName, resolvedLine);
    const dpTtl = Math.max(rec.ttl ?? (existing.ttl || 600), 600);

    await dpUpdateRecord(ak, sk, zoneName, recordId, {
      name: rec.name ?? existing.name,
      type: rec.type ?? existing.type,
      content: rec.content ?? existing.content,
      line: resolvedLine,
      lineName,
      ttl: dpTtl,
      mx: rec.priority ?? existing.mx,
      weight: rec.weight ?? existing.weight,
    });
  } else if (provider.type === "aliyun") {
    const ak = provider.apiAccessKey ?? "";
    const sk = provider.apiSecretKey ?? "";

    const existingRecords = await aliyunListRecords(ak, sk, zoneName);
    const existing = existingRecords.find((r) => r.id === recordId);
    if (!existing) throw new Error("Record not found");

    const aliyunTtl = Math.max(rec.ttl ?? (existing.ttl || 600), 600);
    await aliyunUpdateRecord(ak, sk, recordId, {
      name: rec.name ?? existing.name,
      type: rec.type ?? existing.type,
      content: rec.content ?? existing.content,
      line: rec.line ?? existing.line,
      ttl: aliyunTtl,
      mx: rec.priority ?? existing.mx,
      weight: rec.weight ?? existing.weight,
    });
  } else {
    throw new Error(`Unsupported provider type: ${provider.type}`);
  }
  return null;
}

/** Load all configured providers from Redis. */
export async function loadProviders(): Promise<Provider[]> {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

/** List every zone the provider's credentials can access (unfiltered). */
export async function listProviderZones(p: Provider): Promise<Zone[]> {
  if (p.type === "cloudflare") {
    const result = await cfFetch<CfZone[]>(p.apiKey, "/zones", { query: { per_page: 50 } });
    const cfZones = Array.isArray(result) ? result : [];
    return cfZones.map((z) => ({ id: z.id, name: z.name, status: z.status }));
  }
  if (p.type === "huawei") {
    return hwListZones(p.apiAccessKey ?? "", p.apiSecretKey ?? "", p.region);
  }
  if (p.type === "dnspod") {
    return dpListZones(p.apiAccessKey ?? "", p.apiSecretKey ?? "");
  }
  if (p.type === "aliyun") {
    return aliyunListZones(p.apiAccessKey ?? "", p.apiSecretKey ?? "");
  }
  return [];
}

export interface ZoneListError {
  providerId: string;
  providerName: string;
  message: string;
}

/**
 * Aggregate zones from every configured provider, filtered by each provider's
 * `selectedZones` list. Returns a flat list sorted by zone name.
 */
export async function listAllZones(): Promise<{ zones: ZoneWithProvider[]; errors: ZoneListError[] }> {
  const providers = await loadProviders();
  const errors: ZoneListError[] = [];
  const all: ZoneWithProvider[] = [];

  await Promise.all(
    providers.map(async (p) => {
      try {
        const zoneList = await listProviderZones(p);
        const selected = Array.isArray(p.selectedZones) ? p.selectedZones : [];
        const allow = selected.length > 0 ? new Set(selected) : null;
        for (const z of zoneList) {
          if (allow && !allow.has(z.id)) continue;
          all.push({
            id: z.id,
            name: z.name,
            status: z.status,
            providerId: p.id,
            providerName: p.name,
            providerType: p.type,
          });
        }
      } catch {
        errors.push({
          providerId: p.id,
          providerName: p.name,
          message: "Failed to fetch zones",
        });
      }
    })
  );

  all.sort((a, b) => a.name.localeCompare(b.name));
  return { zones: all, errors };
}

/** List ALL records of a zone (Cloudflare is paginated through). */
export async function listZoneRecords(provider: Provider, zoneId: string, zoneName: string): Promise<DnsRecord[]> {
  if (provider.type === "cloudflare") {
    return fetchAllCfRecords(provider.apiKey, zoneId);
  }
  if (provider.type === "huawei") {
    const recordSets = await listRecordSets(
      provider.apiAccessKey ?? "",
      provider.apiSecretKey ?? "",
      provider.region,
      zoneId
    );
    return recordSets.map((rs) => normalizeHw(rs, zoneName));
  }
  if (provider.type === "dnspod") {
    const dpRecords = await dpListRecords(provider.apiAccessKey ?? "", provider.apiSecretKey ?? "", zoneName);
    return dpRecords.map(normalizeDp);
  }
  if (provider.type === "aliyun") {
    const aliyunRecords = await aliyunListRecords(provider.apiAccessKey ?? "", provider.apiSecretKey ?? "", zoneName);
    return aliyunRecords.map(normalizeAliyun);
  }
  throw new Error(`Unsupported provider type: ${provider.type}`);
}

/** Delete a single record (record set for Huawei Cloud). No logging — use deleteRecordById. */
async function rawDeleteRecord(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  recordId: string,
): Promise<void> {
  if (provider.type === "cloudflare") {
    await cfFetch<{ id: string }>(provider.apiKey, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
  } else if (provider.type === "huawei") {
    await hwDeleteRecordSet(provider.apiAccessKey ?? "", provider.apiSecretKey ?? "", provider.region, zoneId, recordId);
  } else if (provider.type === "dnspod") {
    await dpDeleteRecord(provider.apiAccessKey ?? "", provider.apiSecretKey ?? "", zoneName, recordId);
  } else if (provider.type === "aliyun") {
    await aliyunDeleteRecord(provider.apiAccessKey ?? "", provider.apiSecretKey ?? "", recordId);
  } else {
    throw new Error(`Unsupported provider type: ${provider.type}`);
  }
}

// ---------------------------------------------------------------------------
// Logged mutations. EVERY DNS write in the app goes through these three (or
// through withChangeLog directly, see routes/zones.ts): the change log entry
// with the BEFORE snapshot is written first, and the write is aborted if that
// backup cannot be stored.
// ---------------------------------------------------------------------------

export interface MutationOptions {
  /** Current record, when the caller already has it (saves a provider round-trip). */
  before?: DnsRecord | null;
  /** Id of the change being reverted (restore). */
  restoreOf?: string;
  /** Receives the change-log entry once the mutation succeeded. */
  onChange?: (change: DnsChange) => void;
}

/** Read one record for the backup snapshot. Throws if it can't be read. */
export async function fetchRecordSnapshot(provider: Provider, zoneId: string, zoneName: string, recordId: string): Promise<DnsRecord | null> {
  let records: DnsRecord[];
  try {
    records = await listZoneRecords(provider, zoneId, zoneName);
  } catch (e) {
    throw new Error(`Could not read the current record for backup (${e instanceof Error ? e.message : String(e)}); change not applied`);
  }
  return records.find((r) => r.id === recordId) ?? null;
}

function requestedFields(rec: Partial<ImportRecord>): Partial<DnsRecord> {
  const out: Partial<DnsRecord> = {};
  for (const k of ["type", "name", "content", "ttl", "proxied", "priority", "line", "weight", "comment"] as const) {
    if (rec[k] !== undefined) (out as Record<string, unknown>)[k] = rec[k];
  }
  return out;
}

export async function createNewRecord(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  rec: ImportRecord,
  opts: MutationOptions = {},
): Promise<DnsRecord> {
  const { result, change } = await withChangeLog(
    { provider, zoneId, zoneName, action: "create", before: null, requested: requestedFields(rec), restoreOf: opts.restoreOf },
    () => rawCreateRecord(provider, zoneId, zoneName, rec),
  );
  opts.onChange?.(change);
  return result;
}

export async function updateExistingRecord(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  recordId: string,
  rec: ImportRecord,
  opts: MutationOptions = {},
): Promise<DnsRecord | null> {
  const before = opts.before !== undefined ? opts.before : await fetchRecordSnapshot(provider, zoneId, zoneName, recordId);
  if (!before) throw new Error("Record not found");
  const { result, change } = await withChangeLog(
    { provider, zoneId, zoneName, action: "update", recordId, before, requested: requestedFields(rec), restoreOf: opts.restoreOf },
    () => rawUpdateRecord(provider, zoneId, zoneName, recordId, rec),
    // Providers that don't echo the record: after = before + requested fields.
    (r) => snapshot(r ?? ({ ...before, ...requestedFields(rec), id: recordId } as DnsRecord)),
  );
  opts.onChange?.(change);
  return result;
}

export async function deleteRecordById(
  provider: Provider,
  zoneId: string,
  zoneName: string,
  recordId: string,
  opts: MutationOptions = {},
): Promise<void> {
  const before = opts.before !== undefined ? opts.before : await fetchRecordSnapshot(provider, zoneId, zoneName, recordId);
  if (!before) throw new Error("Record not found");
  const { change } = await withChangeLog(
    { provider, zoneId, zoneName, action: "delete", recordId, before, restoreOf: opts.restoreOf },
    () => rawDeleteRecord(provider, zoneId, zoneName, recordId),
  );
  opts.onChange?.(change);
}
