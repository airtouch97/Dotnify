import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { redis, KEYS } from "./redis.js";
import type { DnsRecord, Provider } from "./types.js";

/**
 * DNS change log / backup.
 *
 * Every DNS mutation (create / update / delete of a record, from the web UI,
 * the REST API, imports, MCP tools or a restore) goes through `withChangeLog`:
 *
 *   1. A "pending" entry with the full BEFORE snapshot is written to Redis
 *      BEFORE the provider is called. If that write fails, the mutation is
 *      aborted (no backup → no change).
 *   2. The provider call runs.
 *   3. The entry is updated with the AFTER snapshot (status "ok") or the error
 *      (status "error").
 *
 * Storage: each entry is a JSON string under `dotnify:dns_change:<id>` (no
 * TTL); `dotnify:dns_changes` is a list of ids, newest first, capped at
 * MAX_ENTRIES. Only entries beyond the cap are ever removed.
 */

export const MAX_ENTRIES = 5000;

export type ChangeAction = "create" | "update" | "delete";
export type ChangeSource = "web" | "mcp" | "system";

export interface ChangeContext {
  source: ChangeSource;
  /** Human-readable actor: web username, or MCP token name. */
  actor: string;
  /** MCP token id (for app-generated tokens) — "env" for the MCP_TOKEN fallback. */
  tokenId?: string;
  ip?: string;
  /** e.g. "web:update_record", "mcp:bind_server_to_domain", "web:import", "web:restore". */
  operation?: string;
}

export interface DnsChange {
  id: string;
  ts: string;
  finishedAt?: string;
  domain: string;
  zoneId: string;
  providerId: string;
  providerName: string;
  providerType: Provider["type"];
  action: ChangeAction;
  /** Record id the change applies to (null for creates until the provider returns one). */
  recordId: string | null;
  before: DnsRecord | null;
  after: DnsRecord | null;
  /** What was requested (fields sent to the provider). */
  requested?: Partial<DnsRecord>;
  source: ChangeSource;
  actor: string;
  tokenId?: string;
  ip?: string;
  operation?: string;
  status: "pending" | "ok" | "error";
  error?: string;
  /** Set on entries created by a restore: id of the entry being reverted. */
  restoreOf?: string;
  /** Set on an entry once it has been restored: id of the restore entry. */
  restoredBy?: string;
}

const als = new AsyncLocalStorage<ChangeContext>();

export function runWithChangeContext<T>(ctx: ChangeContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Run `fn` with the current context plus an operation label. */
export function withOperation<T>(operation: string, fn: () => T): T {
  const cur = als.getStore() ?? { source: "system" as const, actor: "unknown" };
  return als.run({ ...cur, operation }, fn);
}

export function currentChangeContext(): ChangeContext {
  return als.getStore() ?? { source: "system", actor: "unknown" };
}

/** Best-effort client IP from Vercel / proxy headers. */
export function clientIp(header: (name: string) => string | undefined): string | undefined {
  const xff = header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = header("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : undefined;
}

export class ChangeLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeLogError";
  }
}

function parse(raw: unknown): DnsChange | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DnsChange;
    } catch {
      return null;
    }
  }
  return raw as DnsChange;
}

/** Strip non-record helper fields (e.g. RecordView.host/hostname) from a snapshot. */
export function snapshot(r: DnsRecord | null | undefined): DnsRecord | null {
  if (!r) return null;
  const out: DnsRecord = { id: r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl };
  if (r.proxied !== undefined) out.proxied = r.proxied;
  if (r.priority !== undefined && r.priority !== null) out.priority = r.priority;
  if (r.comment) out.comment = r.comment;
  if (r.line) out.line = r.line;
  if (r.status) out.status = r.status;
  if (r.weight !== undefined && r.weight !== null) out.weight = r.weight;
  return out;
}

export async function getChange(id: string): Promise<DnsChange | null> {
  if (!/^[a-z0-9-]{6,64}$/i.test(id)) return null;
  return parse(await redis.get<unknown>(KEYS.dnsChange(id)));
}

export async function saveChange(entry: DnsChange): Promise<void> {
  await redis.set(KEYS.dnsChange(entry.id), JSON.stringify(entry));
}

async function appendChange(entry: DnsChange): Promise<void> {
  // Entry first, then its id in the index: a failure here aborts the mutation.
  await saveChange(entry);
  await redis.lpush(KEYS.dnsChanges, entry.id);
  // Cap the index; only entries beyond MAX_ENTRIES are dropped. Best effort.
  try {
    const len = await redis.llen(KEYS.dnsChanges);
    if (len > MAX_ENTRIES) {
      const old = await redis.lrange<string>(KEYS.dnsChanges, MAX_ENTRIES, -1);
      await redis.ltrim(KEYS.dnsChanges, 0, MAX_ENTRIES - 1);
      if (old.length) await redis.del(...old.map((x) => KEYS.dnsChange(String(x))));
    }
  } catch (e) {
    console.warn("[changelog] trim failed:", e);
  }
}

export interface ChangeMeta {
  provider: Provider;
  zoneId: string;
  zoneName: string;
  action: ChangeAction;
  recordId?: string | null;
  before: DnsRecord | null;
  requested?: Partial<DnsRecord>;
  restoreOf?: string;
}

/**
 * Log-then-mutate. `fn` performs the provider call and returns the resulting
 * record (null for deletes). If the backup write fails the provider is never
 * called and a ChangeLogError is thrown.
 */
export async function withChangeLog<T extends DnsRecord | null | void>(
  meta: ChangeMeta,
  fn: () => Promise<T>,
  afterOf?: (result: T) => DnsRecord | null,
): Promise<{ result: T; change: DnsChange }> {
  const ctx = currentChangeContext();
  const entry: DnsChange = {
    id: `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`,
    ts: new Date().toISOString(),
    domain: meta.zoneName,
    zoneId: meta.zoneId,
    providerId: meta.provider.id,
    providerName: meta.provider.name,
    providerType: meta.provider.type,
    action: meta.action,
    recordId: meta.recordId ?? meta.before?.id ?? null,
    before: snapshot(meta.before),
    after: null,
    ...(meta.requested ? { requested: meta.requested } : {}),
    source: ctx.source,
    actor: ctx.actor,
    ...(ctx.tokenId ? { tokenId: ctx.tokenId } : {}),
    ...(ctx.ip ? { ip: ctx.ip } : {}),
    ...(ctx.operation ? { operation: ctx.operation } : {}),
    ...(meta.restoreOf ? { restoreOf: meta.restoreOf } : {}),
    status: "pending",
  };
  try {
    await appendChange(entry);
  } catch (e) {
    console.error("[changelog] backup write failed, aborting DNS change:", e);
    throw new ChangeLogError("Could not write the DNS change backup; the change was NOT applied. Please retry.");
  }

  let result: T;
  try {
    result = await fn();
  } catch (e) {
    entry.status = "error";
    entry.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    entry.finishedAt = new Date().toISOString();
    await saveChange(entry).catch((err) => console.error("[changelog] failed to record error:", err));
    throw e;
  }
  const after = afterOf ? afterOf(result) : meta.action === "delete" ? null : snapshot((result as DnsRecord | null) ?? null);
  entry.after = snapshot(after);
  if (entry.after && !entry.recordId) entry.recordId = entry.after.id;
  entry.status = "ok";
  entry.finishedAt = new Date().toISOString();
  await saveChange(entry).catch((err) => console.error("[changelog] failed to record result:", err));
  return { result, change: entry };
}

/** List entries newest first, optionally filtered by domain. */
export async function listChanges(opts: { domain?: string; tokenId?: string; cursor?: number; limit?: number }): Promise<{ changes: DnsChange[]; nextCursor: number | null; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const domain = opts.domain?.trim().toLowerCase().replace(/\.$/, "") || "";
  const total = await redis.llen(KEYS.dnsChanges);
  let cursor = Math.max(opts.cursor ?? 0, 0);
  const out: DnsChange[] = [];
  const tokenId = opts.tokenId?.trim() || "";
  const CHUNK = domain || tokenId ? 200 : limit;
  while (out.length < limit && cursor < total) {
    const ids = await redis.lrange<string>(KEYS.dnsChanges, cursor, cursor + CHUNK - 1);
    if (ids.length === 0) break;
    const raws = await redis.mget<unknown[]>(...ids.map((x) => KEYS.dnsChange(String(x))));
    let consumed = 0;
    for (const raw of raws) {
      consumed++;
      const e = parse(raw);
      if (e && (!domain || e.domain.toLowerCase() === domain) && (!tokenId || e.tokenId === tokenId)) {
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    cursor += consumed;
  }
  return { changes: out, nextCursor: cursor < total ? cursor : null, total };
}
