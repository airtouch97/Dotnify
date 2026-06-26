import type { CloudflareResponse } from "./types";

const CF_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Call the Cloudflare REST API. Throws on network/HTTP errors or when
 * Cloudflare's envelope reports `success: false`.
 *
 * @param apiKey  Cloudflare API Token (sent as `Authorization: Bearer <token>`)
 * @param path    Path under /client/v4, e.g. "/zones"
 * @param init    Extra fetch options (method, body, query, etc.)
 */
export async function cfFetch<T>(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean> } = {}
): Promise<T> {
  const url = new URL(CF_BASE + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let payload: CloudflareResponse<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as CloudflareResponse<T>;
    } catch {
      // non-JSON body
    }
  }

  if (!res.ok || (payload && !payload.success)) {
    const msgs = payload?.errors?.map((e) => e.message).join("; ") ?? `Cloudflare request failed (${res.status})`;
    throw new Error(msgs);
  }

  if (!payload) {
    throw new Error("Cloudflare returned an empty response");
  }

  return payload.result as T;
}
