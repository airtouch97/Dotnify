import { createHmac, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Alibaba Cloud DNS (Alidns) API client — ACS3-HMAC-SHA256 signing + fetch.
// Reference: https://help.aliyun.com/document_detail/Alidns_API_Reference
// ---------------------------------------------------------------------------

const ENDPOINT = "alidns.aliyuncs.com";
const VERSION = "2015-01-09";
const ALGORITHM = "ACS3-HMAC-SHA256";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256Hex(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/**
 * URI-encode per Alibaba Cloud ACS3 spec.
 * Unreserved chars: A-Z a-z 0-9 - . _ ~
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * CanonicalURI: each path segment URI-encoded.
 */
function canonicalURI(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const segments = pathname.split("/").map((s) => percentEncode(s));
  return segments.join("/");
}

/**
 * CanonicalQueryString: keys & values URI-encoded, sorted by key.
 */
function canonicalQueryString(params: Record<string, string> | undefined): string {
  if (!params || Object.keys(params).length === 0) return "";
  return Object.entries(params)
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .sort()
    .join("&");
}

/**
 * Build the Authorization header using ACS3-HMAC-SHA256 signing.
 */
function signRequest(opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
  accessKeySecret: string;
  accessKeyId: string;
}): Record<string, string> {
  const { method, url, headers, body, accessKeySecret, accessKeyId } = opts;

  const allHeaders: Record<string, string> = { ...headers };

  // Canonical request
  const cURI = canonicalURI(url.pathname);
  const cQS = canonicalQueryString(
    Object.fromEntries(url.searchParams.entries()) as Record<string, string>
  );

  const headerEntries = Object.entries(allHeaders)
    .map(([k, v]) => ({ k: k.toLowerCase(), v: v.trim() }))
    .sort((a, b) => a.k.localeCompare(b.k));
  const cHeaders = headerEntries.map(({ k, v }) => `${k}:${v}\n`).join("");
  const signedHeaderNames = headerEntries.map(({ k }) => k).join(";");

  // Payload hash
  const payloadHash = body ? sha256Hex(body) : sha256Hex("");

  const canonicalRequest = [method, cURI, cQS, cHeaders, signedHeaderNames, payloadHash].join("\n");
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const stringToSign = `${ALGORITHM}\n${hashedCanonicalRequest}`;
  const signature = hmacSha256Hex(accessKeySecret, stringToSign);

  return {
    ...allHeaders,
    Authorization: `${ALGORITHM} Credential=${accessKeyId},SignedHeaders=${signedHeaderNames},Signature=${signature}`,
  };
}

/**
 * Call the Alibaba Cloud Alidns API with ACS3-HMAC-SHA256 signing.
 */
async function aliyunFetch<T>(
  accessKeyId: string,
  accessKeySecret: string,
  action: string,
  init: {
    method?: string;
    params?: Record<string, string | number | boolean | null | undefined>;
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();

  // Filter null/undefined params
  const queryParams: Record<string, string> = {};
  if (init.params) {
    for (const [k, v] of Object.entries(init.params)) {
      if (v !== null && v !== undefined) queryParams[k] = String(v);
    }
  }

  const url = new URL(`https://${ENDPOINT}/`);
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : undefined;

  const headers: Record<string, string> = {
    host: ENDPOINT,
    "x-acs-action": action,
    "x-acs-version": VERSION,
    "x-acs-signature-nonce": createHash("md5")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex"),
    "x-acs-date": new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-content-sha256": sha256Hex(bodyStr ?? ""),
  };

  if (bodyStr) {
    headers["content-type"] = "application/json; charset=utf-8";
  }

  // For GET/DELETE: params go in query string
  if (method === "GET" || method === "DELETE") {
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
  }

  const signedHeaders = signRequest({
    method,
    url,
    headers,
    body: bodyStr,
    accessKeyId,
    accessKeySecret,
  });

  const res = await fetch(url, {
    method,
    headers: signedHeaders,
    body: bodyStr,
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON
  }

  if (!res.ok) {
    let msg = `Alibaba Cloud request failed (${res.status})`;
    if (json) {
      if (typeof json.Message === "string") {
        // Trim after first sentence for cleaner error messages
        const dotIdx = (json.Message as string).indexOf(".");
        msg = dotIdx > 0 ? (json.Message as string).slice(0, dotIdx + 1) : (json.Message as string);
      } else if (typeof json.message === "string") {
        msg = json.message;
      }
    }
    throw new Error(msg);
  }

  if (!json) return {} as T;
  return json as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AliyunZone {
  id: string;
  name: string;
  status: string;
  recordCount: number;
}

export interface AliyunRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  line: string;
  lineName: string;
  ttl: number;
  mx: number;
  weight: number;
  status: string; // "ENABLE" | "DISABLE"
  remark?: string;
  updateTimestamp?: number;
}

export interface AliyunLine {
  lineCode: string;
  name: string;
  parent: string | null;
}

/**
 * List all domains.
 */
export async function listZones(accessKeyId: string, accessKeySecret: string): Promise<AliyunZone[]> {
  const resp = await aliyunFetch<{
    Domains?: { Domain?: { DomainId?: string; DomainName?: string; RecordCount?: number; DnsStatus?: string }[] };
    TotalCount?: number;
  }>(accessKeyId, accessKeySecret, "DescribeDomains", {
    params: { PageNumber: 1, PageSize: 100 },
  });

  return (resp.Domains?.Domain ?? []).map((d) => ({
    id: d.DomainId ?? "",
    name: d.DomainName ?? "",
    status: d.DnsStatus === "ENABLE" ? "active" : (d.DnsStatus ?? ""),
    recordCount: d.RecordCount ?? 0,
  }));
}

/**
 * List all records in a domain.
 */
export async function listRecords(
  accessKeyId: string,
  accessKeySecret: string,
  domain: string
): Promise<AliyunRecord[]> {
  const resp = await aliyunFetch<{
    DomainRecords?: { Record?: AliyunApiRecord[] };
    TotalCount?: number;
  }>(accessKeyId, accessKeySecret, "DescribeDomainRecords", {
    params: { DomainName: domain, PageNumber: 1, PageSize: 3000 },
  });

  return (resp.DomainRecords?.Record ?? []).map(normalizeApiRecord);
}

interface AliyunApiRecord {
  RecordId?: string;
  RR?: string;
  Type?: string;
  Value?: string;
  Line?: string;
  TTL?: number;
  Priority?: number;
  Weight?: number;
  Status?: string;
  Remark?: string;
  UpdateTimestamp?: number;
}

function normalizeApiRecord(r: AliyunApiRecord): AliyunRecord {
  return {
    id: r.RecordId ?? "",
    name: r.RR ?? "",
    type: r.Type ?? "",
    content: r.Value ?? "",
    line: r.Line ?? "default",
    lineName: r.Line ?? "default",
    ttl: r.TTL ?? 600,
    mx: r.Priority ?? 0,
    weight: r.Weight ?? 0,
    status: r.Status === "ENABLE" ? "ENABLE" : "DISABLE",
    remark: r.Remark,
    updateTimestamp: r.UpdateTimestamp,
  };
}

/**
 * Create a record in a domain.
 */
export async function createRecord(
  accessKeyId: string,
  accessKeySecret: string,
  domain: string,
  params: {
    name: string;
    type: string;
    content: string;
    line?: string;
    ttl?: number;
    mx?: number;
    weight?: number;
  }
): Promise<AliyunRecord> {
  const body: Record<string, unknown> = {
    DomainName: domain,
    RR: params.name,
    Type: params.type,
    Value: params.content,
    Line: params.line ?? "default",
    TTL: params.ttl ?? 600,
  };
  if (params.type === "MX" && params.mx !== undefined) {
    body.Priority = params.mx;
  }
  if (params.weight !== undefined && params.weight > 0) {
    body.Weight = params.weight;
  }

  const resp = await aliyunFetch<{ RecordId?: string }>(
    accessKeyId, accessKeySecret, "AddDomainRecord",
    { method: "POST", body }
  );

  return {
    id: resp.RecordId ?? "",
    name: params.name,
    type: params.type,
    content: params.content,
    line: params.line ?? "default",
    lineName: params.line ?? "default",
    ttl: params.ttl ?? 600,
    mx: params.mx ?? 0,
    weight: params.weight ?? 0,
    status: "ENABLE",
  };
}

/**
 * Update a record.
 */
export async function updateRecord(
  accessKeyId: string,
  accessKeySecret: string,
  recordId: string,
  params: {
    name: string;
    type: string;
    content: string;
    line?: string;
    ttl?: number;
    mx?: number;
    weight?: number;
  }
): Promise<void> {
  const body: Record<string, unknown> = {
    RecordId: recordId,
    RR: params.name,
    Type: params.type,
    Value: params.content,
    Line: params.line ?? "default",
    TTL: params.ttl ?? 600,
  };
  if (params.type === "MX" && params.mx !== undefined) {
    body.Priority = params.mx;
  }
  if (params.weight !== undefined && params.weight > 0) {
    body.Weight = params.weight;
  }

  await aliyunFetch(accessKeyId, accessKeySecret, "UpdateDomainRecord", {
    method: "POST",
    body,
  });
}

/**
 * Delete a record.
 */
export async function deleteRecord(
  accessKeyId: string,
  accessKeySecret: string,
  recordId: string
): Promise<void> {
  await aliyunFetch(accessKeyId, accessKeySecret, "DeleteDomainRecord", {
    method: "POST",
    body: { RecordId: recordId },
  });
}

/**
 * Set record status (enable/disable).
 */
export async function setRecordStatus(
  accessKeyId: string,
  accessKeySecret: string,
  recordId: string,
  status: "enable" | "disable"
): Promise<void> {
  const apiStatus = status === "enable" ? "Enable" : "Disable";
  await aliyunFetch(accessKeyId, accessKeySecret, "SetDomainRecordStatus", {
    method: "POST",
    body: { RecordId: recordId, Status: apiStatus },
  });
}

/**
 * List resolution lines for a domain.
 * Uses DescribeDomainInfo with NeedDetailAttributes=true.
 */
export async function listLines(
  accessKeyId: string,
  accessKeySecret: string,
  domain: string
): Promise<AliyunLine[]> {
  const resp = await aliyunFetch<{
    RecordLines?: { RecordLine?: { LineCode?: string; LineDisplayName?: string; FatherCode?: string }[] };
  }>(accessKeyId, accessKeySecret, "DescribeDomainInfo", {
    params: { DomainName: domain, NeedDetailAttributes: "true", Lang: "zh" },
  });

  return (resp.RecordLines?.RecordLine ?? []).map((l) => ({
    lineCode: l.LineCode ?? "",
    name: l.LineDisplayName ?? "",
    parent: l.FatherCode ?? null,
  }));
}
