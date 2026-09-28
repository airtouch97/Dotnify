export interface MeResponse {
  setupRequired: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface LoginResponse {
  token: string;
  username: string;
}

export interface SetupResponse {
  username: string;
  createdAt: string;
}

export type ProviderType = "cloudflare" | "huawei" | "dnspod" | "aliyun";

export interface Provider {
  id: string;
  type: ProviderType;
  name: string;
  apiKey: string; // masked on read in the UI; backend stores plaintext — Cloudflare token
  apiAccessKey?: string; // Huawei Cloud AK (masked)
  apiSecretKey?: string; // Huawei Cloud SK (masked)
  region?: string; // Huawei Cloud region code
  createdAt: string;
  selectedZones: string[];
}

export interface Zone {
  id: string;
  name: string;
  status: string;
}

/** Zone with its owning provider info, as returned by GET /api/zones. */
export interface ZoneWithProvider extends Zone {
  providerId: string;
  providerName: string;
  providerType: ProviderType;
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
  line?: string; // Huawei Cloud / DNSPod: resolution line
  status?: string; // DNSPod: "enable" | "disable"
  weight?: number; // DNSPod: record weight
}

/** Entry in the named server IP table. */
export interface ServerEntry {
  id: string;
  name: string;
  ip: string;
  ipVersion: 4 | 6;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Result of GET /api/servers/:id/bindings?domain=... (one domain). */
export interface ServerBindings {
  server?: { name: string; ip: string };
  domain: string;
  zoneId: string;
  provider: string;
  providerType: ProviderType;
  bindings: {
    hostname: string;
    type: RecordType;
    content: string;
    ttl: number;
    recordId: string;
    line?: string;
    proxied?: boolean;
  }[];
}

/** MCP access token as listed by GET /api/mcp-tokens (never includes the secret). */
export interface McpToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp?: string | null;
}

export interface McpTokensResponse {
  tokens: McpToken[];
  envTokenConfigured: boolean;
}

/** Result of GET /api/zones/:zoneId/address-records. */
export interface AddressRecordsResponse {
  zoneName: string;
  records: { id: string; type: "A" | "AAAA"; hostname: string; ip: string; ttl: number; vercel: boolean }[];
  vercelCnames: number;
}

/** One entry of the DNS change log (GET /api/changes). */
export interface DnsChange {
  id: string;
  ts: string;
  finishedAt?: string;
  domain: string;
  zoneId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  action: "create" | "update" | "delete";
  recordId: string | null;
  before: DnsRecord | null;
  after: DnsRecord | null;
  requested?: Partial<DnsRecord>;
  source: "web" | "mcp" | "system";
  actor: string;
  tokenId?: string;
  ip?: string;
  operation?: string;
  status: "pending" | "ok" | "error";
  error?: string;
  restoreOf?: string;
  restoredBy?: string;
}

export interface DnsChangesResponse {
  changes: DnsChange[];
  nextCursor: number | null;
  total: number;
  cap: number;
}
