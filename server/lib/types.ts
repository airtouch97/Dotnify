export interface AuthedVariables {
  session: Session;
  token: string;
}

export interface Admin {
  username: string;
  passwordHash: string; // `scrypt:<salt_hex>:<hash_hex>`
  createdAt: string; // ISO timestamp
}

export interface Session {
  username: string;
  createdAt: string; // ISO timestamp
}

export type ProviderType = "cloudflare" | "huawei" | "dnspod" | "aliyun";

export interface Provider {
  id: string;
  type: ProviderType;
  name: string;
  apiKey: string; // plaintext (MVP) — Cloudflare token
  apiAccessKey?: string; // Huawei Cloud AK
  apiSecretKey?: string; // Huawei Cloud SK
  region?: string; // Huawei Cloud region code (e.g. cn-north-1)
  createdAt: string; // ISO timestamp
  /** Zone ids the user chose to manage (empty = all accessible zones). */
  selectedZones: string[];
}

/** Entry in the named server IP table (e.g. "服务器A" → 203.0.113.10). */
export interface ServerEntry {
  id: string;
  name: string; // unique (case-insensitive)
  ip: string; // IPv4 or IPv6
  ipVersion: 4 | 6;
  note?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Zone {
  id: string;
  name: string;
  status: string;
}

export type RecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "NS"
  | "SRV"
  | "CAA"
  | "PTR"
  | "SOA"
  | "SPF"
  | "URI";

export interface DnsRecord {
  id: string;
  type: RecordType;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  comment?: string;
  line?: string; // Huawei Cloud / DNSPod: resolution line (线路类型)
  status?: string; // DNSPod: "enable" | "disable"
  weight?: number; // DNSPod: record weight
}

export interface CloudflareResponse<T> {
  result: T | T[];
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
}

/** App-generated MCP access token. Only the SHA-256 hash is stored. */
export interface McpTokenRecord {
  id: string;
  name: string;
  hash: string; // sha256(token) hex
  prefix: string; // first chars of the token, for display only
  createdAt: string; // ISO timestamp
}
