import { Redis } from "@upstash/redis";

/**
 * Upstash Redis client singleton.
 * Reads credentials from Vercel KV environment variables
 * (KV_REST_API_URL / KV_REST_API_TOKEN), falling back to
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN for local dev.
 */
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  // Defer hard failure until first actual call so the app can still boot
  // (e.g. /api/auth/me returns gracefully when admin is missing).
  console.warn(
    "[redis] KV_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN) is not set. " +
      "Redis calls will fail until these are configured."
  );
}

export const redis = new Redis({
  url: url ?? "",
  token: token ?? "",
});

export const KEYS = {
  admin: "dotnify:admin",
  session: (token: string) => `dotnify:session:${token}`,
  providers: "dotnify:providers",
} as const;
