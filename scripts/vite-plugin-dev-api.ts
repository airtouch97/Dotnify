import type { Plugin, ViteDevServer, Connect } from "vite";
import type { ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";

/**
 * Vite plugin that serves `api` .ts files as Serverless-style endpoints during
 * `vite dev`, so you can run the whole app locally without `vercel dev`.
 *
 * Routes follow Vercel's file-based convention:
 *   api/providers/index.ts              -> /api/providers
 *   api/providers/[id].ts               -> /api/providers/:id
 *   api/providers/[id]/zones.ts         -> /api/providers/:id/zones
 *   api/zones/[zoneId]/records/index.ts -> /api/zones/:zoneId/records
 *   api/zones/[zoneId]/records/[recordId].ts -> /api/zones/:zoneId/records/:recordId
 *
 * Each module default-exports a handler:
 *   (req: ApiRequest, res: ApiResponse) => unknown | Promise<unknown>
 * matching the types in api/_lib/types.ts.
 *
 * Uses Vite's ssrLoadModule, so edits to API files are picked up on the next
 * request (no manual restart needed).
 */
export function devApi(apiRoot = "api"): Plugin {
  let server: ViteDevServer;
  const apiDir = path.resolve(process.cwd(), apiRoot);

  return {
    name: "dotnify-dev-api",
    configureServer(s) {
      server = s;
      // Run before Vite's internal middleware so /api never falls through to
      // the SPA fallback.
      server.middlewares.use(handleApi);
    },
  };

  function handleApi(req: Connect.IncomingMessage, res: ServerResponse, _next: Connect.NextFunction) {
    const url = req.url ?? "";
    if (!url.startsWith("/api/") && url !== "/api") return _next();

    void route(req, res).then(
      (handled) => {
        if (!handled) {
          send(res, 404, { ok: false, error: "Not found" });
        }
      },
      (err) => {
        console.error("[dev-api] route error:", err);
        if (!res.headersSent) {
          send(res, 500, { ok: false, error: "Internal server error" });
        }
      }
    );
  }

  async function route(req: Connect.IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { pathname, searchParams } = safeUrl(req.url ?? "");

    const candidates = resolveCandidates(pathname);
    const match = pickBest(candidates);
    if (!match) return false;

    const mod = await server.ssrLoadModule(match.file);
    const handler = (mod as { default?: unknown }).default;
    if (typeof handler !== "function") {
      send(res, 500, { ok: false, error: `Route ${match.file} has no default export handler` });
      return true;
    }

    const apiReq = {
      method: req.method ?? "GET",
      query: { ...match.params, ...queryToRecord(searchParams) },
      headers: headersToRecord(req.headers),
      body: await readJsonBody(req),
    };

    let statusCode = 200;
    const apiRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        send(res, statusCode, body);
        return this;
      },
      end() {
        res.end();
        return this;
      },
    };

    await handler(apiReq, apiRes);
    return true;
  }

  function resolveCandidates(pathname: string): Candidate[] {
    if (!fs.existsSync(apiDir)) return [];
    const files = walkTs(apiDir);
    const out: Candidate[] = [];
    const segments = splitPath(pathname.replace(/^\/api/, ""));

    for (const file of files) {
      const rel = path.relative(apiDir, file).replace(/\.ts$/, "");
      const pattern = splitPath(rel);
      const params = matchPattern(pattern, segments);
      if (params !== null) out.push({ file, params });
    }
    return out;
  }
}

/* ---------- helpers ---------- */

interface Candidate {
  file: string;
  params: Record<string, string>;
}

function pickBest(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  // Prefer routes with fewer dynamic segments (static beats dynamic).
  return [...candidates].sort((a, b) => countDynamic(a.file) - countDynamic(b.file))[0];
}

function countDynamic(file: string): number {
  return (file.match(/\[[^\]]+\]/g) ?? []).length;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // skip _lib and any private dir/file
    if (entry.name.startsWith("_")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function splitPath(p: string): string[] {
  return p.split("/").filter(Boolean);
}

/**
 * Match a file-pattern against request segments.
 * `[id]` matches one segment and captures it.
 * `index` matches zero segments (must be the last pattern segment).
 */
function matchPattern(pattern: string[], segments: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  let pi = 0;
  let si = 0;
  while (pi < pattern.length) {
    const seg = pattern[pi];
    if (seg === "index") {
      if (pi !== pattern.length - 1) return null; // index must be last
      if (si !== segments.length) return null;     // no trailing segments
      pi++;
      continue;
    }
    if (si >= segments.length) return null;
    if (seg.startsWith("[") && seg.endsWith("]")) {
      params[seg.slice(1, -1)] = decodeURIComponent(segments[si]);
      si++;
      pi++;
      continue;
    }
    if (seg !== segments[si]) return null;
    si++;
    pi++;
  }
  return si === segments.length ? params : null;
}

function safeUrl(url: string): { pathname: string; searchParams: URLSearchParams } {
  try {
    const u = new URL(url, "http://localhost");
    return { pathname: u.pathname, searchParams: u.searchParams };
  } catch {
    return { pathname: url, searchParams: new URLSearchParams() };
  }
}

function queryToRecord(sp: URLSearchParams): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const key of [...new Set(sp.keys())]) {
    const all = sp.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

function headersToRecord(h: Connect.IncomingMessage["headers"]): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = v;
    out[k.toLowerCase()] = v;
  }
  return out;
}

async function readJsonBody(req: Connect.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
