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
 * PATCH /api/zones/:zoneId/records/:recordId?providerId=...
 * Body: partial record fields to update.
 */
async function update(req: AuthedRequest, res: ApiResponse) {
  const zoneId = queryStr(req, "zoneId");
  const recordId = queryStr(req, "recordId");
  const provider = await findProvider(queryStr(req, "providerId"));
  if (!provider) return notFound(res, "Provider not found");
  if (!zoneId || !recordId) return error(res, "zoneId and recordId are required");

  const body = getBody(req) as Partial<DnsRecord>;
  const payload: Record<string, unknown> = {};
  if (body.type !== undefined) payload.type = body.type;
  if (body.name !== undefined) payload.name = body.name;
  if (body.content !== undefined) payload.content = body.content;
  if (body.ttl !== undefined) payload.ttl = body.ttl;
  if (body.proxied !== undefined) payload.proxied = body.proxied;
  if (body.priority !== undefined) payload.priority = body.priority;

  if (Object.keys(payload).length === 0) {
    return error(res, "No fields to update");
  }

  try {
    const result = await cfFetch<CfRecord>(
      provider.apiKey,
      `/zones/${zoneId}/dns_records/${recordId}`,
      { method: "PATCH", body: payload }
    );
    return ok(res, normalize(result));
  } catch (e) {
    return error(res, `Failed to update record: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}

/**
 * DELETE /api/zones/:zoneId/records/:recordId?providerId=...
 */
async function remove(req: AuthedRequest, res: ApiResponse) {
  const zoneId = queryStr(req, "zoneId");
  const recordId = queryStr(req, "recordId");
  const provider = await findProvider(queryStr(req, "providerId"));
  if (!provider) return notFound(res, "Provider not found");
  if (!zoneId || !recordId) return error(res, "zoneId and recordId are required");

  try {
    await cfFetch<{ id: string }>(
      provider.apiKey,
      `/zones/${zoneId}/dns_records/${recordId}`,
      { method: "DELETE" }
    );
    return ok(res, { deleted: true });
  } catch (e) {
    return error(res, `Failed to delete record: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}

export default requireAuth(async (req, res) => {
  if (req.method === "PATCH") return update(req as AuthedRequest, res);
  if (req.method === "DELETE") return remove(req as AuthedRequest, res);
  return error(res, "Method not allowed", 405);
});
