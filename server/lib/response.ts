import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function ok<T>(c: Context, data?: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, data }, status);
}

export function error(c: Context, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ ok: false, error: message }, status);
}

export function unauthorized(c: Context, message = "Unauthorized") {
  return c.json({ ok: false, error: message }, 401);
}

export function notFound(c: Context, message = "Not found") {
  return c.json({ ok: false, error: message }, 404);
}
