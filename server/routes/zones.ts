import { Hono } from "hono";
import { requireAuth } from "../lib/middleware.js";
import { ok, error, notFound } from "../lib/response.js";
import { cfFetch } from "../lib/cloudflare.js";
import {
  listRecordSets,
  updateRecordSet as hwUpdateRecordSet,
} from "../lib/huawei.js";
import { getLines } from "../lib/huawei-line.js";
import {
  listRecords as dpListRecords,
  updateRecord as dpUpdateRecord,
  listLines as dpListLines,
} from "../lib/dnspod.js";
import {
  listRecords as aliyunListRecords,
  updateRecord as aliyunUpdateRecord,
  listLines as aliyunListLines,
} from "../lib/aliyun.js";
import type { DnsRecord } from "../lib/types.js";
import type { AuthedVariables } from "../lib/types.js";
import { toJson, toZoneFile, toCsv } from "../lib/export.js";
import { fromJson, fromZoneFile, fromCsv } from "../lib/import.js";
import {
  type CfRecord,
  findProvider,
  listAllZones,
  normalizeCf,
  normalizeHw,
  normalizeDp,
  normalizeAliyun,
  resolveDpLineName,
  normalizeRecordName,
  fetchAllCfRecords,
  createNewRecord,
  updateExistingRecord,
  listZoneRecords,
  deleteRecordById,
  fetchRecordSnapshot,
} from "../lib/dns.js";
import { withChangeLog, withOperation, ChangeLogError } from "../lib/changelog.js";

class RecordNotFound extends Error {}
import { isVercelCname, isVercelIp } from "../lib/vercel.js";

type Variables = AuthedVariables;

const zones = new Hono<{ Variables: Variables }>();

zones.use("/*", requireAuth);

/**
 * GET /api/zones
 * Aggregate zones from every configured provider, filtered by each provider's
 * `selectedZones` list. Returns a flat list sorted by zone name.
 */
zones.get("/", async (c) => {
  const result = await listAllZones();
  return ok(c, result);
});

/**
 * GET /api/zones/:zoneId/lines
 * Return resolution lines. For Huawei Cloud, from local JSON; for DNSPod, from API.
 */
zones.get("/:zoneId/lines", async (c) => {
  const providerId = c.req.query("providerId");
  const providerType = c.req.query("providerType");

  if (providerType === "dnspod" && providerId) {
    const provider = await findProvider(providerId);
    if (!provider) return notFound(c, "Provider not found");
    const zoneName = c.req.query("zoneName") ?? "";
    try {
      const lines = await dpListLines(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      return ok(c, lines);
    } catch {
      return error(c, "Failed to fetch DNSPod lines", 502);
    }
  }

  if (providerType === "aliyun" && providerId) {
    const provider = await findProvider(providerId);
    if (!provider) return notFound(c, "Provider not found");
    const zoneName = c.req.query("zoneName") ?? "";
    try {
      const lines = await aliyunListLines(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      // Map lineCode → lineId for frontend compatibility
      const mapped = lines.map((l) => ({
        lineId: l.lineCode,
        name: l.name,
        parent: l.parent,
      }));
      return ok(c, mapped);
    } catch {
      return error(c, "Failed to fetch Alibaba Cloud lines", 502);
    }
  }

  return ok(c, getLines());
});

/**
 * GET /api/zones/:zoneId/address-records?providerId=...&zoneName=...
 * A/AAAA records of ONE zone (all pages) for the IP usage page, which calls
 * this once per domain from the browser. Vercel edge IPs are flagged, and
 * CNAMEs to vercel-dns.com are counted (not returned).
 */
zones.get("/:zoneId/address-records", async (c) => {
  const zoneId = c.req.param("zoneId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId) return error(c, "zoneId is required");

  try {
    const all = await listZoneRecords(provider, zoneId, zoneName);
    const records: { id: string; type: string; hostname: string; ip: string; ttl: number; vercel: boolean }[] = [];
    let vercelCnames = 0;
    for (const r of all) {
      if (r.type === "CNAME") {
        if (isVercelCname(r.content)) vercelCnames++;
        continue;
      }
      if (r.type !== "A" && r.type !== "AAAA") continue;
      const host = normalizeRecordName(r.name, zoneName);
      const hostname = host === "@" ? zoneName : `${host}.${zoneName}`;
      // Huawei record sets may hold several IPs ("a, b")
      for (const value of r.content.split(",").map((v) => v.trim()).filter(Boolean)) {
        const ip = r.type === "AAAA" ? value.toLowerCase() : value;
        records.push({ id: r.id, type: r.type, hostname, ip, ttl: r.ttl, vercel: isVercelIp(ip) });
      }
    }
    return ok(c, { zoneName, records, vercelCnames });
  } catch {
    return error(c, "Failed to fetch records", 502);
  }
});

/**
 * GET /api/zones/:zoneId/records?providerId=...
 */
zones.get("/:zoneId/records", async (c) => {
  const zoneId = c.req.param("zoneId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId) return error(c, "zoneId is required");

  try {
    if (provider.type === "cloudflare") {
      const result = await cfFetch<CfRecord[]>(
        provider.apiKey,
        `/zones/${zoneId}/dns_records`,
        { query: { per_page: 100 } }
      );
      const records = (Array.isArray(result) ? result : []).map(normalizeCf);
      return ok(c, records);
    }

    if (provider.type === "huawei") {
      const recordSets = await listRecordSets(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region,
        zoneId
      );
      const records = recordSets.map((rs) => normalizeHw(rs, zoneName));
      return ok(c, records);
    }

    if (provider.type === "dnspod") {
      const dpRecords = await dpListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      const records = dpRecords.map(normalizeDp);
      return ok(c, records);
    }

    if (provider.type === "aliyun") {
      const aliyunRecords = await aliyunListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      const records = aliyunRecords.map(normalizeAliyun);
      return ok(c, records);
    }

    return error(c, `Unsupported provider type: ${provider.type}`, 400);
  } catch {
    return error(c, "Failed to fetch records", 502);
  }
});

/**
 * POST /api/zones/:zoneId/records?providerId=...
 * Body: { type, name, content, ttl, proxied?, priority? }
 */
zones.post("/:zoneId/records", async (c) => {
  const zoneId = c.req.param("zoneId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId) return error(c, "zoneId is required");

  const body = await c.req.json<Partial<DnsRecord>>();
  if (!body.type || !body.name || body.content === undefined) {
    return error(c, "type, name and content are required");
  }

  try {
    // Logged: the change-log backup entry is written before the provider call.
    const created = await withOperation("web:create_record", () =>
      createNewRecord(provider, zoneId, zoneName, {
        type: body.type!,
        name: body.name!,
        content: body.content!,
        ttl: body.ttl as number,
        proxied: body.proxied,
        priority: body.priority,
        line: body.line,
        weight: body.weight,
      }),
    );
    return ok(c, created, 201);
  } catch (e) {
    if (e instanceof ChangeLogError) return error(c, e.message, 503);
    return error(c, "Failed to create record", 502);
  }
});

/**
 * PATCH /api/zones/:zoneId/records/:recordId?providerId=...
 * Body: partial record fields to update.
 */
zones.patch("/:zoneId/records/:recordId", async (c) => {
  const zoneId = c.req.param("zoneId");
  const recordId = c.req.param("recordId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId || !recordId) return error(c, "zoneId and recordId are required");

  const body = await c.req.json<Partial<DnsRecord>>();

  const allowed = ["type", "name", "content", "ttl", "proxied", "priority", "line", "weight"] as const;
  if (!allowed.some((k) => body[k] !== undefined)) return error(c, "No fields to update");

  // Backup snapshot of the current record (aborts if it can't be read).
  let before: DnsRecord | null;
  try {
    before = await fetchRecordSnapshot(provider, zoneId, zoneName, recordId);
  } catch {
    return error(c, "Could not read the current record for backup; change not applied", 502);
  }
  if (!before) return notFound(c, "Record not found");

  const requested: Partial<DnsRecord> = {};
  for (const k of allowed) if (body[k] !== undefined) (requested as Record<string, unknown>)[k] = body[k];

  const doUpdate = async (): Promise<DnsRecord> => {
      if (provider.type === "cloudflare") {
        const isProxied = body.proxied === true;
        const payload: Record<string, unknown> = {};
        if (body.type !== undefined) payload.type = body.type;
        if (body.name !== undefined) payload.name = body.name;
        if (body.content !== undefined) payload.content = body.content;
        // Cloudflare requires TTL=1 (auto) for proxied records
        if (isProxied) {
          payload.ttl = 1;
        } else if (body.ttl !== undefined) {
          payload.ttl = body.ttl;
        }
        if (body.proxied !== undefined) payload.proxied = body.proxied;
        if (body.priority !== undefined) payload.priority = body.priority;


        const result = await cfFetch<CfRecord>(
          provider.apiKey,
          `/zones/${zoneId}/dns_records/${recordId}`,
          { method: "PATCH", body: payload }
        );
        return normalizeCf(result);
      }

      if (provider.type === "huawei") {
        const ak = provider.apiAccessKey ?? "";
        const sk = provider.apiSecretKey ?? "";
        const reg = provider.region;

        const existingSets = await listRecordSets(ak, sk, reg, zoneId);
        const existing = existingSets.find((rs) => rs.id === recordId);
        if (!existing) throw new RecordNotFound();

        const records = body.content !== undefined
          ? (body.content.includes(", ") ? body.content.split(", ") : [body.content])
          : existing.records;

        const rs = await hwUpdateRecordSet(ak, sk, reg, zoneId, recordId, zoneName, {
          name: body.name ?? existing.name,
          type: body.type ?? existing.type,
          ttl: body.ttl ?? existing.ttl,
          records,
          line: body.line ?? existing.line,
        });
        return normalizeHw(rs, zoneName);
      }

      if (provider.type === "dnspod") {
        const ak = provider.apiAccessKey ?? "";
        const sk = provider.apiSecretKey ?? "";

        // DNSPod ModifyRecord requires all fields, so fetch existing first
        const existingRecords = await dpListRecords(ak, sk, zoneName);
        const existing = existingRecords.find((r) => r.id === recordId);
        if (!existing) throw new RecordNotFound();

        const resolvedLine = body.line ?? existing.line;
        const lineName = await resolveDpLineName(ak, sk, zoneName, resolvedLine);
        const dpTtl = Math.max(Number(body.ttl ?? existing.ttl) || 600, 600);

        await dpUpdateRecord(ak, sk, zoneName, recordId, {
          name: body.name ?? existing.name,
          type: body.type ?? existing.type,
          content: body.content ?? existing.content,
          line: resolvedLine,
          lineName,
          ttl: dpTtl,
          mx: body.priority ?? existing.mx,
          weight: body.weight ?? existing.weight,
        });

        // Re-fetch the updated record
        const updatedRecords = await dpListRecords(ak, sk, zoneName);
        const updated = updatedRecords.find((r) => r.id === recordId);
        if (!updated) throw new Error("Record not found after update");
        return normalizeDp(updated);
      }

      if (provider.type === "aliyun") {
        const ak = provider.apiAccessKey ?? "";
        const sk = provider.apiSecretKey ?? "";

        // Aliyun UpdateDomainRecord requires all fields, so fetch existing first
        const existingRecords = await aliyunListRecords(ak, sk, zoneName);
        const existing = existingRecords.find((r) => r.id === recordId);
        if (!existing) throw new RecordNotFound();

        const aliyunTtl = Math.max(Number(body.ttl ?? existing.ttl) || 600, 600);
        await aliyunUpdateRecord(ak, sk, recordId, {
          name: body.name ?? existing.name,
          type: body.type ?? existing.type,
          content: body.content ?? existing.content,
          line: body.line ?? existing.line,
          ttl: aliyunTtl,
          mx: body.priority ?? existing.mx,
          weight: body.weight ?? existing.weight,
        });

        // Re-fetch the updated record
        const updatedRecords = await aliyunListRecords(ak, sk, zoneName);
        const updated = updatedRecords.find((r) => r.id === recordId);
        if (!updated) throw new Error("Record not found after update");
        return normalizeAliyun(updated);
      }

    throw new Error(`Unsupported provider type: ${provider.type}`);
  };

  try {
    const { result } = await withOperation("web:update_record", () =>
      withChangeLog({ provider, zoneId, zoneName, action: "update", recordId, before, requested }, doUpdate),
    );
    return ok(c, result);
  } catch (e) {
    if (e instanceof ChangeLogError) return error(c, e.message, 503);
    if (e instanceof RecordNotFound) return notFound(c, "Record not found");
    return error(c, "Failed to update record", 502);
  }
});

/**
 * DELETE /api/zones/:zoneId/records/:recordId?providerId=...
 */
zones.delete("/:zoneId/records/:recordId", async (c) => {
  const zoneId = c.req.param("zoneId");
  const recordId = c.req.param("recordId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId || !recordId) return error(c, "zoneId and recordId are required");

  let before: DnsRecord | null;
  try {
    before = await fetchRecordSnapshot(provider, zoneId, zoneName, recordId);
  } catch {
    return error(c, "Could not read the current record for backup; change not applied", 502);
  }
  if (!before) return notFound(c, "Record not found");

  try {
    await withOperation("web:delete_record", () => deleteRecordById(provider, zoneId, zoneName, recordId, { before }));
    return ok(c, { deleted: true });
  } catch (e) {
    if (e instanceof ChangeLogError) return error(c, e.message, 503);
    return error(c, "Failed to delete record", 502);
  }
});

/**
 * GET /api/zones/:zoneId/export?providerId=...&zoneName=...&format=json|zonefile|csv
 * Export all DNS records in the specified format.
 */
zones.get("/:zoneId/export", async (c) => {
  const zoneId = c.req.param("zoneId");
  const zoneName = c.req.query("zoneName") ?? "";
  const format = c.req.query("format") ?? "json";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId) return error(c, "zoneId is required");

  // Fetch records (reuse existing logic)
  let records: DnsRecord[] = [];
  try {
    if (provider.type === "cloudflare") {
      records = await fetchAllCfRecords(provider.apiKey, zoneId);
    } else if (provider.type === "huawei") {
      const recordSets = await listRecordSets(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region,
        zoneId
      );
      records = recordSets.map((rs) => normalizeHw(rs, zoneName));
    } else if (provider.type === "dnspod") {
      const dpRecords = await dpListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      records = dpRecords.map(normalizeDp);
    } else if (provider.type === "aliyun") {
      const aliyunRecords = await aliyunListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      records = aliyunRecords.map(normalizeAliyun);
    } else {
      return error(c, `Unsupported provider type: ${provider.type}`, 400);
    }
  } catch {
    return error(c, "Failed to fetch records for export", 502);
  }

  // Convert format
  const safeName = zoneName.replace(/[^a-zA-Z0-9.-]/g, "_");
  let body: string;
  let contentType: string;
  let extension: string;

  if (format === "zonefile") {
    body = toZoneFile(records, zoneName);
    contentType = "text/plain";
    extension = "txt";
  } else if (format === "csv") {
    body = toCsv(records, zoneName);
    contentType = "text/csv";
    extension = "csv";
  } else {
    body = toJson(records, zoneName);
    contentType = "application/json";
    extension = "json";
  }

  return c.body(body, 200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${safeName}.${extension}"`,
  });
});

/**
 * POST /api/zones/:zoneId/import?providerId=...&zoneName=...
 * Body: { format: "json"|"zonefile"|"csv", content: string, strategy: "skip"|"overwrite"|"append" }
 */
zones.post("/:zoneId/import", async (c) => {
  const zoneId = c.req.param("zoneId");
  const zoneName = c.req.query("zoneName") ?? "";
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId) return error(c, "zoneId is required");

  const body = await c.req.json<{ format?: string; content?: string; strategy?: string }>();
  const format = body.format ?? "json";
  const content = body.content ?? "";
  const strategy = body.strategy ?? "append";

  if (!content) return error(c, "content is required");

  // Parse records from the given format
  const result =
    format === "zonefile" ? fromZoneFile(content, zoneName) :
    format === "csv" ? fromCsv(content, zoneName) :
    fromJson(content, zoneName);

  if (result.records.length === 0 && result.errors.length > 0) {
    return error(c, `Parse failed: ${result.errors.join("; ")}`, 400);
  }

  // Fetch existing records for conflict detection
  let existing: DnsRecord[] = [];
  try {
    if (provider.type === "cloudflare") {
      existing = await fetchAllCfRecords(provider.apiKey, zoneId);
    } else if (provider.type === "huawei") {
      const recordSets = await listRecordSets(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region,
        zoneId
      );
      existing = recordSets.map((rs) => normalizeHw(rs, zoneName));
    } else if (provider.type === "dnspod") {
      const dpRecords = await dpListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      existing = dpRecords.map(normalizeDp);
    } else if (provider.type === "aliyun") {
      const aliyunRecords = await aliyunListRecords(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        zoneName
      );
      existing = aliyunRecords.map(normalizeAliyun);
    }
  } catch {
    // If we can't fetch existing records, fall back to append-only
  }

  // Build a set of existing (name, type, content) tuples for conflict detection.
  // Using content in addition to name+type avoids false matches when multiple
  // records of the same type exist (e.g. multiple TXT or A records).
  // Normalize names the same way the import parsers do (strip zone suffix, @ for apex).
  const existingKeys = new Set(
    existing.map((r) => `${normalizeRecordName(r.name, zoneName)}:${r.type}:${r.content}`)
  );
  // Also track name+type only, for types that should be unique (CNAME)
  const existingNameTypeKeys = new Set(
    existing.map((r) => `${normalizeRecordName(r.name, zoneName)}:${r.type}`)
  );

  let created = 0;
  let skipped = 0;
  let updated = 0;
  const importErrors: string[] = [...result.errors];

  await withOperation("web:import", async () => {
  for (const rec of result.records) {
    const nameTypeKey = `${rec.name}:${rec.type}`;
    const fullKey = `${rec.name}:${rec.type}:${rec.content}`;
    // A record "exists" if the exact same name+type+content is present,
    // OR if it's a CNAME (which must be unique per name)
    const isCname = rec.type === "CNAME";
    const exists = existingKeys.has(fullKey) || (isCname && existingNameTypeKeys.has(nameTypeKey));

    if (exists && strategy === "skip") {
      skipped++;
      continue;
    }

    if (strategy === "overwrite" && existingNameTypeKeys.has(nameTypeKey)) {
      // Find the existing record ID (match by normalized name + type + content for exact match,
      // or by name + type for CNAME which must be unique)
      const match = isCname
        ? existing.find((r) => normalizeRecordName(r.name, zoneName) === rec.name && r.type === rec.type)
        : existing.find((r) => normalizeRecordName(r.name, zoneName) === rec.name && r.type === rec.type && r.content === rec.content);
      if (match) {
        try {
          await updateExistingRecord(provider, zoneId, zoneName, match.id, rec, { before: match });
          updated++;
        } catch (e) {
          const detail = e instanceof Error ? e.message : "";
          importErrors.push(`Failed to update ${rec.name} (${rec.type}): ${detail}`);
        }
        continue;
      }
    }

    // append or overwrite-with-no-match: create new
    try {
      await createNewRecord(provider, zoneId, zoneName, rec);
      created++;
    } catch (e) {
      const detail = e instanceof Error ? e.message : "";
      importErrors.push(`Failed to create ${rec.name} (${rec.type}): ${detail}`);
    }
  }
  });

  return ok(c, { created, skipped, updated, errors: importErrors });
});
export default zones;
