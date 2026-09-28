import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "../lib/middleware.js";
import { ok, error } from "../lib/response.js";
import { listServers, createServer, updateServer, deleteServer, findServer, ServerTableError } from "../lib/servers.js";
import { findBindings, BindingError } from "../lib/binding.js";
import type { AuthedVariables } from "../lib/types.js";

const servers = new Hono<{ Variables: AuthedVariables }>();

servers.use("/*", requireAuth);

function handleError(c: Context, e: unknown) {
  if (e instanceof ServerTableError || e instanceof BindingError) {
    return error(c, e.message, e.status);
  }
  throw e;
}

async function readJson<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    return {} as T;
  }
}

/**
 * GET /api/servers
 * List all named servers (sorted by name).
 */
servers.get("/", async (c) => {
  return ok(c, await listServers());
});

/**
 * POST /api/servers
 * Body: { name, ip, note? } — name must be unique, ip must be a valid IPv4/IPv6.
 */
servers.post("/", async (c) => {
  const body = await readJson<{ name?: unknown; ip?: unknown; note?: unknown }>(c);
  try {
    const entry = await createServer(body);
    return ok(c, entry, 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/**
 * PATCH /api/servers/:id
 * Body: partial { name, ip, note } (note: "" clears it).
 */
servers.patch("/:id", async (c) => {
  const body = await readJson<{ name?: unknown; ip?: unknown; note?: unknown }>(c);
  try {
    const entry = await updateServer(c.req.param("id"), body);
    return ok(c, entry);
  } catch (e) {
    return handleError(c, e);
  }
});

/**
 * DELETE /api/servers/:id
 * Removes the server from the table. DNS records are NOT touched.
 */
servers.delete("/:id", async (c) => {
  try {
    await deleteServer(c.req.param("id"));
    return ok(c, { deleted: true });
  } catch (e) {
    return handleError(c, e);
  }
});

/**
 * GET /api/servers/:id/bindings?domain=example.com
 * Hostnames (A/AAAA) in ONE managed domain pointing to this server's IP.
 * `domain` is required so a single request never scans every domain.
 */
servers.get("/:id/bindings", async (c) => {
  const domain = c.req.query("domain")?.trim();
  if (!domain) return error(c, "domain query parameter is required");
  try {
    const server = await findServer(c.req.param("id"));
    if (!server) return error(c, "Server not found", 404);
    const result = await findBindings({ server: server.id, domain });
    return ok(c, result);
  } catch (e) {
    return handleError(c, e);
  }
});

export default servers;
