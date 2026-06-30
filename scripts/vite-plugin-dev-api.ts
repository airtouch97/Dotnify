import type { Plugin, ViteDevServer, Connect } from "vite";
import type { ServerResponse } from "node:http";

/**
 * Vite plugin that mounts the Hono API app on the Vite dev server so both
 * frontend and API are served from a single port during development.
 *
 * Uses Vite's ssrLoadModule so edits to server/ files are picked up on the
 * next request (no manual restart needed).
 */
export function devApi(): Plugin {
  let server: ViteDevServer;

  return {
    name: "dotnify-dev-api",
    configureServer(s) {
      server = s;
      // Run before Vite's internal middleware so /api never falls through to
      // the SPA fallback.
      server.middlewares.use(handleApi);
    },
  };

  function handleApi(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
    const url = req.url ?? "";
    if (!url.startsWith("/api/") && url !== "/api") return next();

    void (async () => {
      try {
        const mod = await server.ssrLoadModule("/server/index.ts");
        const app = (mod as { default?: { fetch: typeof fetch } }).default;
        if (!app || typeof app.fetch !== "function") {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: "Hono app not found" }));
          return;
        }

        // Collect the request body.
        const chunks: Buffer[] = [];
        for await (const c of req) {
          chunks.push(typeof c === "string" ? Buffer.from(c) : c);
        }
        const body = Buffer.concat(chunks);

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v == null) continue;
          headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }

        const incoming = new Request(`http://localhost:${server.config.server.port ?? 5173}${url}`, {
          method: req.method ?? "GET",
          headers,
          body: body.length > 0 ? body : undefined,
        });

        const response = await app.fetch(incoming);

        res.statusCode = response.status;
        for (const [k, v] of response.headers.entries()) {
          res.setHeader(k, v);
        }
        const responseBody = await response.arrayBuffer();
        res.end(Buffer.from(responseBody));
      } catch (err) {
        console.error("[dev-api] error:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
        }
      }
    })();
  }
}
