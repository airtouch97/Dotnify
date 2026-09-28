import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { extractBearerToken } from "../lib/auth.js";
import { buildMcpServer } from "../lib/mcp.js";
import { verifyAppToken } from "../lib/mcp-tokens.js";
import { runWithChangeContext, clientIp, type ChangeContext } from "../lib/changelog.js";

/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses).
 *
 *   POST /api/mcp   Authorization: Bearer <token>
 *
 * Accepted tokens: tokens generated on the MCP Access page (/mcp, stored as
 * SHA-256 hashes in Redis), or — optional fallback — the MCP_TOKEN env var.
 * With neither configured every request is 401.
 *
 * Each request gets a fresh McpServer + transport, so it works both on the
 * Node server (Docker / npm start) and on Vercel
 * serverless functions (no sessions, no long-lived SSE streams).
 */
const mcp = new Hono();

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function tokenMatches(provided: string, expected: string): boolean {
  // Hash both sides so lengths match and comparison is constant-time.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Allow browser-based MCP clients (e.g. MCP Inspector). Auth is a bearer
// header, not cookies, so a wildcard origin is safe.
mcp.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
    exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version", "WWW-Authenticate"],
  }),
);

mcp.use("/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const token = extractBearerToken(c.req.header("authorization"));
  const ip = clientIp((n) => c.req.header(n));
  let ctx: ChangeContext | null = null;
  if (token) {
    // 1) Tokens generated on the MCP Access page (hash stored in Redis)
    const rec = await verifyAppToken(token, ip);
    if (rec) ctx = { source: "mcp", actor: `MCP token "${rec.name}" (${rec.prefix}…)`, tokenId: rec.id, ip };
    // 2) Optional fallback: MCP_TOKEN environment variable
    const envToken = process.env.MCP_TOKEN?.trim();
    if (!ctx && envToken && tokenMatches(token, envToken)) ctx = { source: "mcp", actor: "MCP_TOKEN (env)", tokenId: "env", ip };
  }
  if (!ctx) {
    c.header("WWW-Authenticate", 'Bearer realm="dotnify-mcp"');
    return c.json(
      jsonRpcError(-32001, "Unauthorized: missing or invalid bearer token. Create one on the MCP Access page (/mcp) of Dotnify."),
      401,
    );
  }
  // DNS changes made by MCP tools in this request are attributed to this token.
  await runWithChangeContext(ctx, () => next());
});

mcp.post("/", async (c) => {
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON instead of SSE — serverless friendly
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } finally {
    // JSON mode resolves only after the response is complete, so it's safe to close.
    void transport.close();
    void server.close();
  }
});

// Stateless server: no standalone SSE stream (GET) and no sessions to delete.
const methodNotAllowed = () =>
  new Response(JSON.stringify(jsonRpcError(-32000, "Method not allowed. Use POST.")), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST" },
  });
mcp.get("/", methodNotAllowed);
mcp.delete("/", methodNotAllowed);

export default mcp;
