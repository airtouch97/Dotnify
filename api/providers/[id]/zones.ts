import { requireAuth } from "../../_lib/middleware";
import { redis, KEYS } from "../../_lib/redis";
import { ok, error, notFound } from "../../_lib/response";
import { queryStr } from "../../_lib/http";
import { cfFetch } from "../../_lib/cloudflare";
import type { ApiResponse, Provider, Zone } from "../../_lib/types";
import type { AuthedRequest } from "../../_lib/middleware";

interface CfZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
}

/**
 * GET /api/providers/:id/zones
 * Proxy Cloudflare's /zones list (filtered to this token's accessible zones).
 */
async function list(req: AuthedRequest, res: ApiResponse) {
  const id = queryStr(req, "id");

  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const providers = Array.isArray(raw) ? raw : [];
  const provider = providers.find((p) => p.id === id);
  if (!provider) return notFound(res, "Provider not found");

  try {
    const result = await cfFetch<CfZone[]>(provider.apiKey, "/zones", {
      query: { per_page: 50 },
    });
    const zones: Zone[] = (Array.isArray(result) ? result : []).map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status,
    }));
    return ok(res, zones);
  } catch (e) {
    return error(res, `Failed to fetch zones: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}

export default requireAuth(async (req, res) => {
  if (req.method === "GET") return list(req as AuthedRequest, res);
  return error(res, "Method not allowed", 405);
});
