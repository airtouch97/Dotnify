import { redis } from "./redis.js";
import type { Context, Next } from "hono";

/**
 * Redis-backed rate limiter keyed by IP.
 * Allows `maxAttempts` requests per `windowSeconds` per IP.
 * Works across serverless cold starts and multiple instances.
 *
 * INCR and EXPIRE NX are sent together in a single pipeline (one HTTP
 * round-trip on Upstash REST) so a network failure between them can't
 * leave the counter key without a TTL — which would otherwise let the
 * count grow unbounded and permanently block that IP. EXPIRE NX only
 * sets the TTL when the key has none, so the first request establishes
 * the window and later requests leave it untouched (fixed-window
 * semantics); if the first EXPIRE is ever lost, the next request heals it.
 */
export function rateLimit({
  windowSeconds = 60,
  maxAttempts = 10,
  keyPrefix = "dotnify:ratelimit",
} = {}) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const key = `${keyPrefix}:${ip}`;

    const [count] = await redis
      .pipeline()
      .incr(key)
      .expire(key, windowSeconds, "NX")
      .exec<[number, 0 | 1]>();

    if (count > maxAttempts) {
      return c.json(
        { ok: false, error: "Too many requests, please try again later" },
        429,
      );
    }

    return next();
  };
}
