import { requireAuth } from "../_lib/middleware";
import { redis, KEYS } from "../_lib/redis";
import { ok, error, notFound } from "../_lib/response";
import { getBody, queryStr } from "../_lib/http";
import { cfFetch } from "../_lib/cloudflare";
import type { ApiResponse, Provider } from "../_lib/types";
import type { AuthedRequest } from "../_lib/middleware";

async function loadProviders(): Promise<Provider[]> {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

async function saveProviders(list: Provider[]): Promise<void> {
  await redis.set(KEYS.providers, JSON.stringify(list));
}

function maskKey(p: Provider): Provider {
  const k = p.apiKey;
  const masked = k.length <= 4 ? "****" : `${"*".repeat(Math.min(8, k.length - 4))}${k.slice(-4)}`;
  return { ...p, apiKey: masked };
}

/**
 * PATCH /api/providers/:id
 * Update name and/or apiKey. If apiKey is changed we re-verify it against
 * Cloudflare before persisting.
 */
async function update(req: AuthedRequest, res: ApiResponse) {
  const id = queryStr(req, "id");
  const body = getBody(req) as { name?: string; apiKey?: string };

  const list = await loadProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return notFound(res, "Provider not found");

  const provider = list[idx];
  const newName = body.name?.trim();
  const newKey = body.apiKey?.trim();

  if (newName) provider.name = newName;

  if (newKey && newKey !== provider.apiKey) {
    try {
      await cfFetch<{ id: string; status: string }>(newKey, "/user/tokens/verify");
    } catch (e) {
      return error(res, `Cloudflare token verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }
    provider.apiKey = newKey;
  }

  list[idx] = provider;
  await saveProviders(list);
  return ok(res, maskKey(provider));
}

/**
 * DELETE /api/providers/:id
 * Remove a provider from the list.
 */
async function remove(req: AuthedRequest, res: ApiResponse) {
  const id = queryStr(req, "id");
  const list = await loadProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return notFound(res, "Provider not found");

  list.splice(idx, 1);
  await saveProviders(list);
  return ok(res, { deleted: true });
}

export default requireAuth(async (req, res) => {
  if (req.method === "PATCH") return update(req as AuthedRequest, res);
  if (req.method === "DELETE") return remove(req as AuthedRequest, res);
  return error(res, "Method not allowed", 405);
});
