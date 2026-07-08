import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Alibaba Cloud DNS (Alidns) API client — V1 HMAC-SHA1 signing + fetch.
// Reference: https://help.aliyun.com/document_detail/Alidns_API_Reference
// Uses the classic Alibaba Cloud signature (same as the PHP reference).
// ---------------------------------------------------------------------------

const ENDPOINT = "alidns.aliyuncs.com";
const VERSION = "2015-01-09";

/**
 * Percent-encode per Alibaba Cloud V1 spec.
 * + → %20, * → %2A, %7E → ~
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~")
    .replace(/\+/g, "%20");
}

/**
 * Generate Alibaba Cloud V1 HMAC-SHA1 signature.
 */
function generateSignature(
  params: Record<string, string>,
  accessKeySecret: string,
  method: string
): string {
  // Sort parameters by key
  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `${method}&${percentEncode("/")}&${percentEncode(canonicalQueryString)}`;
  return createHmac("sha1", accessKeySecret + "&")
    .update(stringToSign)
    .digest("base64");
}

/**
 * Call the Alibaba Cloud Alidns API with V1 HMAC-SHA1 signing.
 */
async function aliyunFetch<T>(
  accessKeyId: string,
  accessKeySecret: string,
  action: string,
  init: {
    method?: string;
    params?: Record<string, string | number | boolean | null | undefined>;
  } = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();

  // Build common parameters
  const commonParams: Record<string, string> = {
    Format: "JSON",
    Version: VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    Action: action,
  };

  // Merge action-specific params (filter null/undefined)
  if (init.params) {
    for (const [k, v] of Object.entries(init.params)) {
      if (v !== null && v !== undefined) commonParams[k] = String(v);
    }
  }

  // Compute signature
  const signature = generateSignature(commonParams, accessKeySecret, method);
  commonParams.Signature = signature;

  // Build URL and body based on method
  const url = new URL(`https://${ENDPOINT}/`);
  let body: string | undefined;

  if (method === "GET") {
    for (const [k, v] of Object.entries(commonParams)) {
      url.searchParams.set(k, v);
    }
  } else {
    // POST: form-encoded body
    body = Object.entries(commonParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  const res = await fetch(url, {
    method,
    headers: body
      ? { "Content-Type": "application/x-www-form-urlencoded" }
      : {},
    body,
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
    Domains?: { Domain?: { DomainId?: string; DomainName?: string; RecordCount?: number }[] };
    TotalCount?: number;
  }>(accessKeyId, accessKeySecret, "DescribeDomains", {
    params: { PageNumber: 1, PageSize: 50 },
  });

  return (resp.Domains?.Domain ?? []).map((d) => ({
    id: d.DomainId ?? "",
    name: d.DomainName ?? "",
    // Alidns DescribeDomains has no status field; if listed, it's active
    status: "active",
    recordCount: d.RecordCount ?? 0,
  }));
}

/**
 * List all records in a domain (with pagination, max PageSize=500).
 */
export async function listRecords(
  accessKeyId: string,
  accessKeySecret: string,
  domain: string
): Promise<AliyunRecord[]> {
  const all: AliyunRecord[] = [];
  let page = 1;
  const pageSize = 500;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await aliyunFetch<{
      DomainRecords?: { Record?: AliyunApiRecord[] };
      TotalCount?: number;
    }>(accessKeyId, accessKeySecret, "DescribeDomainRecords", {
      params: { DomainName: domain, PageNumber: page, PageSize: pageSize },
    });
    const batch = (resp.DomainRecords?.Record ?? []).map(normalizeApiRecord);
    all.push(...batch);
    if (batch.length < pageSize) break;
    page++;
  }
  return all;
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
  const apiParams: Record<string, string | number | boolean | null | undefined> = {
    DomainName: domain,
    RR: params.name,
    Type: params.type,
    Value: params.content,
    Line: params.line ?? "default",
    TTL: params.ttl ?? 600,
  };
  if (params.type === "MX" && params.mx !== undefined) {
    apiParams.Priority = params.mx;
  }
  if (params.weight !== undefined && params.weight > 0) {
    apiParams.Weight = params.weight;
  }

  const resp = await aliyunFetch<{ RecordId?: string }>(
    accessKeyId, accessKeySecret, "AddDomainRecord",
    { method: "POST", params: apiParams }
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
  const apiParams: Record<string, string | number | boolean | null | undefined> = {
    RecordId: recordId,
    RR: params.name,
    Type: params.type,
    Value: params.content,
    Line: params.line ?? "default",
    TTL: params.ttl ?? 600,
  };
  if (params.type === "MX" && params.mx !== undefined) {
    apiParams.Priority = params.mx;
  }
  if (params.weight !== undefined && params.weight > 0) {
    apiParams.Weight = params.weight;
  }

  await aliyunFetch(accessKeyId, accessKeySecret, "UpdateDomainRecord", {
    method: "POST",
    params: apiParams,
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
    params: { RecordId: recordId },
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
    params: { RecordId: recordId, Status: apiStatus },
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
