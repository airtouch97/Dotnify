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

export type ProviderType = "cloudflare" | "huawei";

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
  line?: string; // Huawei Cloud: resolution line (线路类型)
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
