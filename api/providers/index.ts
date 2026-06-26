import { randomBytes } from "node:crypto";
import { requireAuth } from "../_lib/middleware";
import { redis, KEYS } from "../_lib/redis";
import { ok, error } from "../_lib/response";
import { cfFetch } from "../_lib/cloudflare";
import type { ApiResponse, Provider } from "../_lib/types";
import type { AuthedRequest } from "../_lib/middleware";
import { getBody } from "../_lib/http";

/**
 * GET /api/providers
 * List all configured providers. API keys are masked before being sent to the
 * client (only the last 4 chars are visible).
 */
async function list(_req: AuthedRequest, res: ApiResponse) {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const providers = Array.isArray(raw) ? raw : [];
  const masked = providers.map(maskKey);
  return ok(res, masked);
}

/**
 * POST /api/providers
 * Add a new provider. For Cloudflare we immediately verify the token by
 * hitting GET /user/tokens/verify; if it fails we reject the request.
 *
 * Body: { type: "cloudflare", name, apiKey }
 */
async function create(req: AuthedRequest, res: ApiResponse) {
  const body = getBody(req) as { type?: string; name?: string; apiKey?: string };
  const type = body.type;
  const name = body.name?.trim();
  const apiKey = body.apiKey?.trim();

  if (type !== "cloudflare") {
    return error(res, "Only 'cloudflare' provider type is supported in this MVP");
  }
  if (!name) return error(res, "Name is required");
  if (!apiKey) return error(res, "API key is required");

  // Verify the token by calling Cloudflare's token-verify endpoint.
  try {
    await cfFetch<{ id: string; status: string }>(apiKey, "/user/tokens/verify");
  } catch (e) {
    return error(res, `Cloudflare token verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
  }

  const provider: Provider = {
    id: randomBytes(8).toString("hex"),
    type: "cloudflare",
    name,
    apiKey,
    createdAt: new Date().toISOString(),
  };

  const existing = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const list = Array.isArray(existing) ? existing : [];
  list.push(provider);
  await redis.set(KEYS.providers, JSON.stringify(list));

  return ok(res, maskKey(provider), 201);
}

function maskKey(p: Provider): Provider {
  const k = p.apiKey;
  const masked = k.length <= 4 ? "****" : `${"*".repeat(Math.min(8, k.length - 4))}${k.slice(-4)}`;
  return { ...p, apiKey: masked };
}

export default requireAuth(async (req, res) => {
  if (req.method === "GET") return list(req as AuthedRequest, res);
  if (req.method === "POST") return create(req as AuthedRequest, res);
  return error(res, "Method not allowed", 405);
});
