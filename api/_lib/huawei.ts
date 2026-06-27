import { createHmac, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Huawei Cloud DNS REST API client — pure fetch + AK/SK signing (no SDK).
// ---------------------------------------------------------------------------

const SDK_SIGNING_ALGORITHM = "SDK-HMAC-SHA256";
const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256Hex(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function sdkDate(): string {
  // Format: YYYYMMDDTHHmmssZ  (UTC)
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * URI-encode per Huawei Cloud spec (similar to AWS SigV4).
 * Unreserved chars: A-Z a-z 0-9 - . _ ~
 */
function uriEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * CanonicalURI: each path segment URI-encoded, trailing slash appended.
 */
function canonicalURI(pathname: string): string {
  const segments = pathname.split("/");
  const encoded = segments.map((s) => uriEncode(s)).join("/");
  return encoded.endsWith("/") ? encoded : encoded + "/";
}

/**
 * CanonicalQueryString: keys & values URI-encoded, sorted by key.
 */
function canonicalQueryString(params: Record<string, string> | undefined): string {
  if (!params) return "";
  const entries = Object.entries(params)
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .sort();
  return entries.join("&");
}

/**
 * Build the Authorization header using AK/SK HMAC-SHA256 signing.
 */
function signRequest(opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
  ak: string;
  sk: string;
}): Record<string, string> {
  const { method, url, headers, body, ak, sk } = opts;
  const dateTime = sdkDate();

  const allHeaders: Record<string, string> = {
    ...headers,
    host: url.host,
    "x-sdk-date": dateTime,
  };

  // Canonical request
  const cURI = canonicalURI(url.pathname);
  const cQS = canonicalQueryString(
    Object.fromEntries(url.searchParams.entries()) as Record<string, string>
  );

  const headerEntries = Object.entries(allHeaders)
    .map(([k, v]) => ({ k: k.toLowerCase(), v }))
    .sort((a, b) => a.k.localeCompare(b.k));
  const cHeaders = headerEntries.map(({ k, v }) => `${k}:${v}\n`).join("");
  const signedHeaderNames = headerEntries.map(({ k }) => k).join(";");

  // Payload hash
  const payloadHash = body ? sha256Hex(body) : EMPTY_BODY_SHA256;

  const canonicalRequest = [method, cURI, cQS, cHeaders, signedHeaderNames, payloadHash].join("\n");
  const canonicalRequestHash = sha256Hex(canonicalRequest);
  const stringToSign = [SDK_SIGNING_ALGORITHM, dateTime, canonicalRequestHash].join("\n");
  const signature = hmacSha256Hex(sk, stringToSign);

  return {
    ...allHeaders,
    Authorization: `${SDK_SIGNING_ALGORITHM} Access=${ak}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

/**
 * Call the Huawei Cloud DNS REST API with AK/SK signing.
 */
async function hwFetch<T>(
  ak: string,
  sk: string,
  endpoint: string,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number> } = {}
): Promise<T> {
  const url = new URL(`https://${endpoint}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const method = (init.method ?? "GET").toUpperCase();
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : undefined;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const signedHeaders = signRequest({
    method,
    url,
    headers,
    body: bodyStr,
    ak,
    sk,
  });

  const res = await fetch(url, {
    method,
    headers: signedHeaders,
    body: bodyStr,
  });

  if (!res.ok) {
    let msg = `Huawei Cloud request failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: string; error_msg?: string };
      if (errBody.message) msg = errBody.message;
      if (errBody.error_msg) msg = errBody.error_msg;
    } catch {
      // non-JSON
    }
    throw new Error(msg);
  }

  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HwZone {
  id: string;
  name: string;
  status: string;
}

export interface HwRecordSet {
  id: string;
  name: string;
  type: string;
  ttl: number;
  records: string[];
  status?: string;
  line?: string;
}

function endpoint(region?: string): string {
  return region ? `dns.${region}.myhuaweicloud.com` : "dns.myhuaweicloud.com";
}

/**
 * Convert a short host name to Huawei Cloud's full domain name format.
 *   @  →  example.com.
 *   www  →  www.example.com.
 *   (empty)  →  example.com.
 * If the name already ends with the zone name + dot, return as-is.
 */
function getHost(name: string, zoneName: string): string {
  const zone = zoneName.replace(/\.$/, ""); // strip trailing dot if present
  const suffix = `${zone}.`;
  // Already fully qualified?
  if (name.endsWith(suffix)) return name;
  // @ or empty → zone root
  if (name === "@" || name === "") return suffix;
  // Subdomain
  return `${name}.${suffix}`;
}

/**
 * Strip the zone suffix from a Huawei Cloud full domain name for display.
 *   www.example.com.  →  www
 *   example.com.  →  @
 */
export function stripHost(fullName: string, zoneName: string): string {
  const zone = zoneName.replace(/\.$/, "");
  const suffix = `${zone}.`;
  if (fullName === suffix || fullName === zone) return "@";
  if (fullName.endsWith(`.${suffix}`)) return fullName.slice(0, -(`.${suffix}`).length);
  if (fullName.endsWith(`.${zone}`)) return fullName.slice(0, -(`.${zone}`).length);
  return fullName;
}

/**
 * Wrap TXT record value in quotes if not already quoted.
 */
function wrapTxtValue(value: string, type: string): string {
  if (type === "TXT" && !value.startsWith('"')) {
    return `"${value}"`;
  }
  return value;
}

/**
 * List all public zones.
 */
export async function listZones(ak: string, sk: string, region?: string): Promise<HwZone[]> {
  const resp = await hwFetch<{ zones?: { id?: string; name?: string; status?: string }[] }>(
    ak, sk, endpoint(region), "/v2/zones", { query: { limit: "50" } }
  );
  return (resp.zones ?? []).map((z) => ({
    id: z.id ?? "",
    name: (z.name ?? "").replace(/\.$/, ""),
    status: (z.status ?? "").toLowerCase(),
  }));
}

/**
 * List all record sets in a zone.
 */
export async function listRecordSets(ak: string, sk: string, region: string | undefined, zoneId: string): Promise<HwRecordSet[]> {
  // Use v2.1 API to get the `line` field (resolution line / 线路类型)
  const resp = await hwFetch<{ recordsets?: { id?: string; name?: string; type?: string; ttl?: number; records?: string[]; status?: string; line?: string }[] }>(
    ak, sk, endpoint(region), `/v2.1/zones/${zoneId}/recordsets`, { query: { limit: "100" } }
  );
  return (resp.recordsets ?? []).map((rs) => ({
    id: rs.id ?? "",
    name: rs.name ?? "",
    type: rs.type ?? "",
    ttl: rs.ttl ?? 300,
    records: rs.records ?? [],
    status: rs.status,
    line: rs.line,
  }));
}

/**
 * Create a record set in a zone.
 */
export async function createRecordSet(
  ak: string, sk: string, region: string | undefined, zoneId: string, zoneName: string,
  params: { name: string; type: string; ttl: number; records: string[]; line?: string }
): Promise<HwRecordSet> {
  const name = getHost(params.name, zoneName);
  const records = params.records.map((r) => wrapTxtValue(r, params.type));
  const body: Record<string, unknown> = { name, type: params.type, ttl: params.ttl, records };
  if (params.line) body.line = params.line;
  const resp = await hwFetch<{
    id?: string; name?: string; type?: string; ttl?: number; records?: string[]; status?: string; line?: string;
  }>(
    ak, sk, endpoint(region), `/v2.1/zones/${zoneId}/recordsets`,
    { method: "POST", body }
  );
  return {
    id: resp.id ?? "",
    name: resp.name ?? "",
    type: resp.type ?? "",
    ttl: resp.ttl ?? 300,
    records: resp.records ?? [],
    status: resp.status,
    line: resp.line,
  };
}

/**
 * Update a record set in a zone.
 * Huawei Cloud requires the full `records` array (not PATCH semantics).
 */
export async function updateRecordSet(
  ak: string, sk: string, region: string | undefined, zoneId: string, recordSetId: string, zoneName: string,
  params: { name?: string; type?: string; ttl?: number; records?: string[]; line?: string }
): Promise<HwRecordSet> {
  const body: Record<string, unknown> = {};
  if (params.name !== undefined) body.name = getHost(params.name, zoneName);
  if (params.type !== undefined) body.type = params.type;
  if (params.ttl !== undefined) body.ttl = params.ttl;
  if (params.records !== undefined) {
    const recType = params.type ?? "";
    body.records = params.records.map((r) => wrapTxtValue(r, recType));
  }
  if (params.line !== undefined) body.line = params.line;

  const resp = await hwFetch<{
    id?: string; name?: string; type?: string; ttl?: number; records?: string[]; status?: string; line?: string;
  }>(
    ak, sk, endpoint(region), `/v2.1/zones/${zoneId}/recordsets/${recordSetId}`,
    { method: "PUT", body }
  );
  return {
    id: resp.id ?? "",
    name: resp.name ?? "",
    type: resp.type ?? "",
    ttl: resp.ttl ?? 300,
    records: resp.records ?? [],
    status: resp.status,
    line: resp.line,
  };
}

/**
 * Delete a record set from a zone.
 */
export async function deleteRecordSet(
  ak: string, sk: string, region: string | undefined, zoneId: string, recordSetId: string
): Promise<void> {
  await hwFetch(
    ak, sk, endpoint(region), `/v2.1/zones/${zoneId}/recordsets/${recordSetId}`,
    { method: "DELETE" }
  );
}

