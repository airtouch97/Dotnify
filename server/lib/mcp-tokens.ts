import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { redis, KEYS } from "./redis.js";
import type { McpTokenRecord } from "./types.js";

/**
 * MCP access tokens generated from the UI.
 *
 * - Token format: `dtn_mcp_<43 chars base64url>` (256 bits of randomness).
 * - Only sha256(token) is stored (JSON array under `dotnify:mcp_tokens`);
 *   the plaintext is returned exactly once, at creation.
 * - "Last used" is a separate small key per token (`dotnify:mcp_token_used:<id>`),
 *   refreshed at most once a minute, so auth never rewrites the token list.
 */

export const TOKEN_PREFIX = "dtn_mcp_";
const NAME_MAX = 64;
const MAX_TOKENS = 50;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export class McpTokenError extends Error {
  status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "McpTokenError";
    this.status = status;
  }
}

export interface McpTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function loadTokens(): Promise<McpTokenRecord[]> {
  const raw = (await redis.get<McpTokenRecord[]>(KEYS.mcpTokens)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

async function saveTokens(list: McpTokenRecord[]): Promise<void> {
  await redis.set(KEYS.mcpTokens, JSON.stringify(list));
}

/** Last-used value: `{ at, ip }` JSON (legacy: a bare ISO timestamp string). */
function parseLastUsed(raw: unknown): { at: string | null; ip: string | null } {
  if (raw == null) return { at: null, ip: null };
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim().startsWith("{")) return { at: raw, ip: null };
    try {
      v = JSON.parse(raw);
    } catch {
      return { at: null, ip: null };
    }
  }
  if (v && typeof v === "object") {
    const o = v as { at?: unknown; ip?: unknown };
    return { at: typeof o.at === "string" ? o.at : null, ip: typeof o.ip === "string" ? o.ip : null };
  }
  return { at: String(v), ip: null };
}

export async function listTokens(): Promise<McpTokenView[]> {
  const list = await loadTokens();
  const lastUsed = await Promise.all(list.map((t) => redis.get<unknown>(KEYS.mcpTokenLastUsed(t.id))));
  return list
    .map((t, i) => {
      const lu = parseLastUsed(lastUsed[i]);
      return { id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: lu.at, lastUsedIp: lu.ip };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createToken(nameInput: unknown): Promise<{ token: string; record: McpTokenView }> {
  const name = typeof nameInput === "string" ? nameInput.trim() : "";
  if (!name) throw new McpTokenError("Token name is required");
  if (name.length > NAME_MAX) throw new McpTokenError(`Token name must be at most ${NAME_MAX} characters`);

  const list = await loadTokens();
  if (list.length >= MAX_TOKENS) throw new McpTokenError(`Too many tokens (max ${MAX_TOKENS}); revoke unused ones first`, 409);

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const record: McpTokenRecord = {
    id: randomBytes(8).toString("hex"),
    name,
    hash: hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 4),
    createdAt: new Date().toISOString(),
  };
  list.push(record);
  await saveTokens(list);
  return { token, record: { id: record.id, name, prefix: record.prefix, createdAt: record.createdAt, lastUsedAt: null, lastUsedIp: null } };
}

export async function revokeToken(id: string): Promise<void> {
  const list = await loadTokens();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) throw new McpTokenError("Token not found", 404);
  list.splice(idx, 1);
  await saveTokens(list);
  await redis.del(KEYS.mcpTokenLastUsed(id));
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verify a presented bearer token against the stored hashes. Returns the
 * matching record (and records last-used time) or null.
 */
export async function verifyAppToken(token: string, ip?: string): Promise<McpTokenRecord | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const list = await loadTokens();
  let found: McpTokenRecord | null = null;
  for (const t of list) {
    if (safeEqualHex(t.hash, hash)) found = t; // no early exit: constant-ish time
  }
  if (found) {
    const key = KEYS.mcpTokenLastUsed(found.id);
    try {
      const prev = parseLastUsed(await redis.get<unknown>(key));
      const prevMs = prev.at ? Date.parse(prev.at) : 0;
      const ipChanged = (ip ?? null) !== prev.ip;
      if (!prevMs || ipChanged || Date.now() - prevMs > LAST_USED_WRITE_INTERVAL_MS) {
        await redis.set(key, JSON.stringify({ at: new Date().toISOString(), ip: ip ?? null }));
      }
    } catch (e) {
      console.warn("[mcp] failed to record token last-used:", e);
    }
  }
  return found;
}
