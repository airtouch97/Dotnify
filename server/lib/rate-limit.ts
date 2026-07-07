import { redis } from "./redis.js";
import type { Context, Next } from "hono";

/**
 * Redis-backed rate limiter keyed by IP.
 * Allows `maxAttempts` requests per `windowSeconds` per IP.
 * Works across serverless cold starts and multiple instances.
 */
export function rateLimit({ windowSeconds = 60, maxAttempts = 10, keyPrefix = "dotnify:ratelimit" } = {}) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const key = `${keyPrefix}:${ip}`;

    const count = await redis.incr(key);
    if (count === 1) {
      // First request in this window — set TTL
      await redis.expire(key, windowSeconds);
    }

    if (count > maxAttempts) {
      return c.json({ ok: false, error: "Too many requests, please try again later" }, 429);
    }

    return next();
  };
}
