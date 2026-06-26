import type { ApiRequest } from "./types";

/**
 * Get the parsed JSON body of a Vercel function request. Vercel auto-parses
 * `application/json` bodies into `req.body`, but we guard against the body
 * being a raw string (e.g. when content-type wasn't set) by parsing it.
 */
export function getBody(req: ApiRequest): unknown {
  const body = req.body;
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

/** Read a single string query param, preferring the first value if multiple. */
export function queryStr(req: ApiRequest, key: string): string | undefined {
  const v = req.query?.[key];
  if (Array.isArray(v)) return v[0];
  return v;
}
