import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "../lib/middleware.js";
import { ok, error } from "../lib/response.js";
import { listTokens, createToken, revokeToken, McpTokenError } from "../lib/mcp-tokens.js";
import type { AuthedVariables } from "../lib/types.js";

const mcpTokens = new Hono<{ Variables: AuthedVariables }>();

mcpTokens.use("/*", requireAuth);

function handleError(c: Context, e: unknown) {
  if (e instanceof McpTokenError) return error(c, e.message, e.status);
  throw e;
}

/**
 * GET /api/mcp-tokens
 * List tokens (never includes the secret or its hash), plus whether the
 * MCP_TOKEN env fallback is configured.
 */
mcpTokens.get("/", async (c) => {
  const tokens = await listTokens();
  return ok(c, { tokens, envTokenConfigured: !!process.env.MCP_TOKEN?.trim() });
});

/**
 * POST /api/mcp-tokens
 * Body: { name } → { token, record }. The plaintext token is only returned here.
 */
mcpTokens.post("/", async (c) => {
  let body: { name?: unknown } = {};
  try {
    body = await c.req.json<{ name?: unknown }>();
  } catch {
    /* empty body */
  }
  try {
    return ok(c, await createToken(body.name), 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/**
 * DELETE /api/mcp-tokens/:id
 * Revoke a token immediately.
 */
mcpTokens.delete("/:id", async (c) => {
  try {
    await revokeToken(c.req.param("id"));
    return ok(c, { revoked: true });
  } catch (e) {
    return handleError(c, e);
  }
});

export default mcpTokens;
