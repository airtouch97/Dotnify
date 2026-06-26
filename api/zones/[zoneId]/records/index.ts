import { requireAuth } from "../../../_lib/middleware";
import { redis, KEYS } from "../../../_lib/redis";
import { ok, error, notFound } from "../../../_lib/response";
import { getBody, queryStr } from "../../../_lib/http";
import { cfFetch } from "../../../_lib/cloudflare";
import type { ApiResponse, Provider, DnsRecord } from "../../../_lib/types";
import type { AuthedRequest } from "../../../_lib/middleware";

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

function normalize(r: CfRecord): DnsRecord {
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

/**
 * GET /api/zones/:zoneId/records?providerId=...
 */
async function list(req: AuthedRequest, res: ApiResponse) {
  const zoneId = queryStr(req, "zoneId");
  const provider = await findProvider(queryStr(req, "providerId"));
  if (!provider) return notFound(res, "Provider not found");
  if (!zoneId) return error(res, "zoneId is required");

  try {
    const result = await cfFetch<CfRecord[]>(
      provider.apiKey,
      `/zones/${zoneId}/dns_records`,
      { query: { per_page: 100 } }
    );
    const records = (Array.isArray(result) ? result : []).map(normalize);
    return ok(res, records);
  } catch (e) {
    return error(res, `Failed to fetch records: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}

/**
 * POST /api/zones/:zoneId/records?providerId=...
 * Body: { type, name, content, ttl, proxied?, priority? }
 */
async function create(req: AuthedRequest, res: ApiResponse) {
  const zoneId = queryStr(req, "zoneId");
  const provider = await findProvider(queryStr(req, "providerId"));
  if (!provider) return notFound(res, "Provider not found");
  if (!zoneId) return error(res, "zoneId is required");

  const body = getBody(req) as Partial<DnsRecord>;
  if (!body.type || !body.name || body.content === undefined) {
    return error(res, "type, name and content are required");
  }

  const payload: Record<string, unknown> = {
    type: body.type,
    name: body.name,
    content: body.content,
    ttl: body.ttl ?? 1, // 1 = auto
  };
  if (body.proxied !== undefined) payload.proxied = body.proxied;
  if (body.priority !== undefined) payload.priority = body.priority;

  try {
    const result = await cfFetch<CfRecord>(
      provider.apiKey,
      `/zones/${zoneId}/dns_records`,
      { method: "POST", body: payload }
    );
    return ok(res, normalize(result), 201);
  } catch (e) {
    return error(res, `Failed to create record: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}

export default requireAuth(async (req, res) => {
  if (req.method === "GET") return list(req as AuthedRequest, res);
  if (req.method === "POST") return create(req as AuthedRequest, res);
  return error(res, "Method not allowed", 405);
});
