import { Hono } from "hono";
import { requireAuth } from "../lib/middleware.js";
import { redis, KEYS } from "../lib/redis.js";
import { ok, error, notFound } from "../lib/response.js";
import { cfFetch } from "../lib/cloudflare.js";
import {
  listZones as hwListZones,
  listRecordSets,
  createRecordSet as hwCreateRecordSet,
  updateRecordSet as hwUpdateRecordSet,
  deleteRecordSet as hwDeleteRecordSet,
  stripHost,
} from "../lib/huawei.js";
import { getLines } from "../lib/huawei-line.js";
import type { Provider, Zone, DnsRecord } from "../lib/types.js";
import type { AuthedVariables } from "../lib/types.js";

type Variables = AuthedVariables;

const zones = new Hono<{ Variables: Variables }>();

zones.use("/*", requireAuth);

interface CfZone {
  id: string;
  name: string;
  status: string;
}

interface ZoneWithProvider extends Zone {
  providerId: string;
  providerName: string;
  providerType: Provider["type"];
}

/**
 * GET /api/zones
 * Aggregate zones from every configured provider, filtered by each provider's
 * `selectedZones` list. Returns a flat list sorted by zone name.
 */
zones.get("/", async (c) => {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const providers = Array.isArray(raw) ? raw : [];

  const errors: { providerId: string; providerName: string; message: string }[] = [];
  const all: ZoneWithProvider[] = [];

  await Promise.all(
    providers.map(async (p) => {
      try {
        let zoneList: Zone[] = [];

        if (p.type === "cloudflare") {
          const result = await cfFetch<CfZone[]>(p.apiKey, "/zones", { query: { per_page: 50 } });
          const cfZones = Array.isArray(result) ? result : [];
          zoneList = cfZones.map((z) => ({ id: z.id, name: z.name, status: z.status }));
        } else if (p.type === "huawei") {
          zoneList = await hwListZones(
            p.apiAccessKey ?? "",
            p.apiSecretKey ?? "",
            p.region
          );
        }

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
  return ok(c, { zones: all, errors });
});

/**
 * GET /api/zones/:zoneId/lines
 * Return Huawei Cloud resolution lines from local JSON file.
 */
zones.get("/:zoneId/lines", async (c) => {
  return ok(c, getLines());
});

async function findProvider(providerId: string | undefined): Promise<Provider | null> {
  if (!providerId) return null;
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const providers = Array.isArray(raw) ? raw : [];
  return providers.find((p) => p.id === providerId) ?? null;
}

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  comment?: string | { content?: string };
}

function normalizeCf(r: CfRecord): DnsRecord {
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

function normalizeHw(rs: { id: string; name: string; type: string; ttl: number; records: string[]; line?: string }, zoneName: string): DnsRecord {
  return {
    id: rs.id,
    type: rs.type as DnsRecord["type"],
    name: stripHost(rs.name, zoneName),
    content: rs.records.length > 1 ? rs.records.join(", ") : (rs.records[0] ?? ""),
    ttl: rs.ttl,
    line: rs.line,
  };
}

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
    if (provider.type === "cloudflare") {
      // Cloudflare requires TTL=1 (auto) for proxied records
      const isProxied = body.proxied === true;
      const payload: Record<string, unknown> = {
        type: body.type,
        name: body.name,
        content: body.content,
        ttl: isProxied ? 1 : (body.ttl ?? 1),
      };
      if (body.proxied !== undefined) payload.proxied = body.proxied;
      if (body.priority !== undefined) payload.priority = body.priority;

      const result = await cfFetch<CfRecord>(
        provider.apiKey,
        `/zones/${zoneId}/dns_records`,
        { method: "POST", body: payload }
      );
      return ok(c, normalizeCf(result), 201);
    }

    if (provider.type === "huawei") {
      const records = body.content.includes(", ")
        ? body.content.split(", ")
        : [body.content];
      const rs = await hwCreateRecordSet(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region,
        zoneId,
        zoneName,
        {
          name: body.name,
          type: body.type,
          ttl: body.ttl ?? 300,
          records,
          line: body.line,
        }
      );
      return ok(c, normalizeHw(rs, zoneName), 201);
    }

    return error(c, `Unsupported provider type: ${provider.type}`, 400);
  } catch {
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

  try {
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

      if (Object.keys(payload).length === 0) {
        return error(c, "No fields to update");
      }

      const result = await cfFetch<CfRecord>(
        provider.apiKey,
        `/zones/${zoneId}/dns_records/${recordId}`,
        { method: "PATCH", body: payload }
      );
      return ok(c, normalizeCf(result));
    }

    if (provider.type === "huawei") {
      const ak = provider.apiAccessKey ?? "";
      const sk = provider.apiSecretKey ?? "";
      const reg = provider.region;

      const existingSets = await listRecordSets(ak, sk, reg, zoneId);
      const existing = existingSets.find((rs) => rs.id === recordId);
      if (!existing) return notFound(c, "Record not found");

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
      return ok(c, normalizeHw(rs, zoneName));
    }

    return error(c, `Unsupported provider type: ${provider.type}`, 400);
  } catch {
    return error(c, "Failed to update record", 502);
  }
});

/**
 * DELETE /api/zones/:zoneId/records/:recordId?providerId=...
 */
zones.delete("/:zoneId/records/:recordId", async (c) => {
  const zoneId = c.req.param("zoneId");
  const recordId = c.req.param("recordId");
  const provider = await findProvider(c.req.query("providerId"));
  if (!provider) return notFound(c, "Provider not found");
  if (!zoneId || !recordId) return error(c, "zoneId and recordId are required");

  try {
    if (provider.type === "cloudflare") {
      await cfFetch<{ id: string }>(
        provider.apiKey,
        `/zones/${zoneId}/dns_records/${recordId}`,
        { method: "DELETE" }
      );
      return ok(c, { deleted: true });
    }

    if (provider.type === "huawei") {
      await hwDeleteRecordSet(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region,
        zoneId,
        recordId
      );
      return ok(c, { deleted: true });
    }

    return error(c, `Unsupported provider type: ${provider.type}`, 400);
  } catch {
    return error(c, "Failed to delete record", 502);
  }
});

export default zones;
