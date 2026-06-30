import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../lib/middleware.js";
import { redis, KEYS } from "../lib/redis.js";
import { ok, error, notFound } from "../lib/response.js";
import { cfFetch } from "../lib/cloudflare.js";
import { listZones as hwListZones } from "../lib/huawei.js";
import type { Provider, Zone } from "../lib/types.js";
import type { AuthedVariables } from "../lib/types.js";

type Variables = AuthedVariables;

const providers = new Hono<{ Variables: Variables }>();

providers.use("/*", requireAuth);

interface CfZone {
  id: string;
  name: string;
  status: string;
}

function maskStr(k: string): string {
  return k.length <= 4 ? "****" : `${"*".repeat(Math.min(8, k.length - 4))}${k.slice(-4)}`;
}

function maskKey(p: Provider): Provider {
  const masked: Provider = {
    ...p,
    apiKey: p.apiKey ? maskStr(p.apiKey) : "",
    selectedZones: Array.isArray(p.selectedZones) ? p.selectedZones : [],
  };
  if (p.apiAccessKey) masked.apiAccessKey = maskStr(p.apiAccessKey);
  if (p.apiSecretKey) masked.apiSecretKey = maskStr(p.apiSecretKey);
  return masked;
}

/**
 * GET /api/providers
 * List all configured providers. API keys are masked before being sent to the
 * client (only the last 4 chars are visible).
 */
providers.get("/", async (c) => {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const list = Array.isArray(raw) ? raw : [];
  const masked = list.map(maskKey);
  return ok(c, masked);
});

/**
 * POST /api/providers
 * Add a new provider. Verifies the credentials, then fetches the zone
 * list so the caller can pick which zones to manage.
 */
providers.post("/", async (c) => {
  const body = await c.req.json<{
    type?: string;
    name?: string;
    apiKey?: string;
    apiAccessKey?: string;
    apiSecretKey?: string;
    region?: string;
    selectedZones?: string[];
  }>();
  const type = body.type;
  const name = body.name?.trim();
  const apiKey = body.apiKey?.trim();
  const apiAccessKey = body.apiAccessKey?.trim();
  const apiSecretKey = body.apiSecretKey?.trim();
  const region = body.region?.trim();
  const selectedZones = Array.isArray(body.selectedZones) ? body.selectedZones : [];

  if (type !== "cloudflare" && type !== "huawei") {
    return error(c, "Only 'cloudflare' and 'huawei' provider types are supported");
  }
  if (!name) return error(c, "Name is required");

  if (type === "cloudflare") {
    if (!apiKey) return error(c, "API key is required");

    // Verify the token by calling Cloudflare's token-verify endpoint.
    try {
      await cfFetch<{ id: string; status: string }>(apiKey, "/user/tokens/verify");
    } catch (e) {
      return error(c, `Cloudflare token verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }

    // Validate selectedZones against the token's accessible zones (if any were picked).
    if (selectedZones.length > 0) {
      let accessible: CfZone[] = [];
      try {
        accessible = await cfFetch<CfZone[]>(apiKey, "/zones", { query: { per_page: 50 } });
      } catch (e) {
        return error(c, `Failed to fetch zones for validation: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
      const validIds = new Set(accessible.map((z) => z.id));
      const invalid = selectedZones.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return error(c, `Some selected zones are not accessible with this token: ${invalid.join(", ")}`, 422);
      }
    }
  } else {
    // Huawei Cloud
    if (!apiAccessKey) return error(c, "Access Key ID is required");
    if (!apiSecretKey) return error(c, "Secret Access Key is required");

    // Verify by listing zones (will throw on auth failure).
    try {
      const zones = await hwListZones(apiAccessKey, apiSecretKey, region || undefined);
      // Validate selectedZones
      if (selectedZones.length > 0) {
        const validIds = new Set(zones.map((z) => z.id));
        const invalid = selectedZones.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
          return error(c, `Some selected zones are not accessible: ${invalid.join(", ")}`, 422);
        }
      }
    } catch (e) {
      return error(c, `Huawei Cloud verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }
  }

  const provider: Provider = {
    id: randomBytes(8).toString("hex"),
    type: type as Provider["type"],
    name,
    apiKey: type === "cloudflare" ? apiKey! : "",
    ...(type === "huawei" ? { apiAccessKey, apiSecretKey, region } : {}),
    createdAt: new Date().toISOString(),
    selectedZones,
  };

  const existing = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const list = Array.isArray(existing) ? existing : [];
  list.push(provider);
  await redis.set(KEYS.providers, JSON.stringify(list));

  return ok(c, maskKey(provider), 201);
});

/**
 * POST /api/providers/verify
 * Verify a provider's credentials and return the zones it can access, without
 * persisting anything. Used by the Add Provider flow to let the user pick
 * zones before saving.
 */
providers.post("/verify", async (c) => {
  const body = await c.req.json<{
    type?: string;
    apiKey?: string;
    apiAccessKey?: string;
    apiSecretKey?: string;
    region?: string;
  }>();
  const type = body.type;
  const apiKey = body.apiKey?.trim();
  const apiAccessKey = body.apiAccessKey?.trim();
  const apiSecretKey = body.apiSecretKey?.trim();
  const region = body.region?.trim();

  if (type === "cloudflare") {
    if (!apiKey) return error(c, "API key is required");

    try {
      await cfFetch<{ id: string; status: string }>(apiKey, "/user/tokens/verify");
    } catch (e) {
      return error(c, `Cloudflare token verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }

    try {
      const result = await cfFetch<CfZone[]>(apiKey, "/zones", { query: { per_page: 50 } });
      const zones: Zone[] = (Array.isArray(result) ? result : []).map((z) => ({
        id: z.id,
        name: z.name,
        status: z.status,
      }));
      return ok(c, zones);
    } catch (e) {
      return error(c, `Failed to fetch zones: ${e instanceof Error ? e.message : "unknown error"}`, 502);
    }
  }

  if (type === "huawei") {
    if (!apiAccessKey) return error(c, "Access Key ID is required");
    if (!apiSecretKey) return error(c, "Secret Access Key is required");

    try {
      const zones = await hwListZones(apiAccessKey, apiSecretKey, region || undefined);
      return ok(c, zones);
    } catch (e) {
      return error(c, `Huawei Cloud verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }
  }

  return error(c, "Only 'cloudflare' and 'huawei' provider types are supported");
});

async function loadProviders(): Promise<Provider[]> {
  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

async function saveProviders(list: Provider[]): Promise<void> {
  await redis.set(KEYS.providers, JSON.stringify(list));
}

/**
 * PATCH /api/providers/:id
 * Update name and/or credentials. If credentials change we re-verify before persisting.
 */
providers.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    apiKey?: string;
    apiAccessKey?: string;
    apiSecretKey?: string;
    region?: string;
    selectedZones?: string[];
  }>();

  const list = await loadProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return notFound(c, "Provider not found");

  const provider = list[idx];
  const newName = body.name?.trim();

  if (newName) provider.name = newName;

  if (provider.type === "cloudflare") {
    const newKey = body.apiKey?.trim();
    if (newKey && newKey !== provider.apiKey) {
      try {
        await cfFetch<{ id: string; status: string }>(newKey, "/user/tokens/verify");
      } catch (e) {
        return error(c, `Cloudflare token verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
      }
      provider.apiKey = newKey;
    }
  } else if (provider.type === "huawei") {
    const newAk = body.apiAccessKey?.trim();
    const newSk = body.apiSecretKey?.trim();
    const newRegion = body.region?.trim();
    const credsChanged =
      (newAk && newAk !== provider.apiAccessKey) ||
      (newSk && newSk !== provider.apiSecretKey) ||
      (newRegion && newRegion !== provider.region);

    if (credsChanged) {
      const ak = newAk || provider.apiAccessKey || "";
      const sk = newSk || provider.apiSecretKey || "";
      const reg = newRegion || provider.region;
      try {
        await hwListZones(ak, sk, reg || undefined);
      } catch (e) {
        return error(c, `Huawei Cloud verification failed: ${e instanceof Error ? e.message : "unknown error"}`, 422);
      }
      if (newAk) provider.apiAccessKey = newAk;
      if (newSk) provider.apiSecretKey = newSk;
      if (newRegion) provider.region = newRegion;
    }
  }

  if (Array.isArray(body.selectedZones)) {
    provider.selectedZones = body.selectedZones;
  }

  list[idx] = provider;
  await saveProviders(list);
  return ok(c, maskKey(provider));
});

/**
 * DELETE /api/providers/:id
 * Remove a provider from the list.
 */
providers.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const list = await loadProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return notFound(c, "Provider not found");

  list.splice(idx, 1);
  await saveProviders(list);
  return ok(c, { deleted: true });
});

/**
 * GET /api/providers/:id/zones
 * List zones accessible to this provider.
 */
providers.get("/:id/zones", async (c) => {
  const id = c.req.param("id");

  const raw = (await redis.get<Provider[]>(KEYS.providers)) ?? [];
  const list = Array.isArray(raw) ? raw : [];
  const provider = list.find((p) => p.id === id);
  if (!provider) return notFound(c, "Provider not found");

  try {
    if (provider.type === "cloudflare") {
      const result = await cfFetch<CfZone[]>(provider.apiKey, "/zones", {
        query: { per_page: 50 },
      });
      const zones: Zone[] = (Array.isArray(result) ? result : []).map((z) => ({
        id: z.id,
        name: z.name,
        status: z.status,
      }));
      return ok(c, zones);
    }

    if (provider.type === "huawei") {
      const zones = await hwListZones(
        provider.apiAccessKey ?? "",
        provider.apiSecretKey ?? "",
        provider.region
      );
      return ok(c, zones);
    }

    return error(c, `Unsupported provider type: ${provider.type}`, 400);
  } catch (e) {
    return error(c, `Failed to fetch zones: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
});

export default providers;
