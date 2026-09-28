import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { redis, KEYS } from "./redis.js";
import type { ServerEntry } from "./types.js";

/**
 * Named server IP table ("服务器A" → 1.2.3.4).
 *
 * Stored as a single JSON array under `dotnify:servers`, mirroring how
 * providers are persisted. Names are unique (case-insensitive, trimmed).
 */

export const SERVER_NAME_MAX = 64;
export const SERVER_NOTE_MAX = 500;

/** Thrown for invalid input / conflicts; `status` maps to an HTTP status. */
export class ServerTableError extends Error {
  status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ServerTableError";
    this.status = status;
  }
}

/**
 * Validate + normalize an IP address. Accepts IPv4 or IPv6 (optionally in
 * brackets). Returns the normalized string and its family, or null if invalid.
 */
export function normalizeIp(input: string): { ip: string; version: 4 | 6 } | null {
  let ip = input.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const family = isIP(ip);
  if (family === 4) {
    // Reject leading zeros like 01.2.3.4 (ambiguous octal notation)
    if (ip.split(".").some((o) => o.length > 1 && o.startsWith("0"))) return null;
    return { ip, version: 4 };
  }
  if (family === 6) {
    if (ip.includes("%")) return null; // zone ids make no sense in DNS
    return { ip: ip.toLowerCase(), version: 6 };
  }
  return null;
}

/** Canonical comparison key for server names. */
function nameKey(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** Compare two IPs for equality (IPv6 compared after expansion). */
export function sameIp(a: string, b: string): boolean {
  const na = normalizeIp(a);
  const nb = normalizeIp(b);
  if (!na || !nb || na.version !== nb.version) return false;
  if (na.version === 4) return na.ip === nb.ip;
  return expandIpv6(na.ip) === expandIpv6(nb.ip);
}

function expandIpv6(ip: string): string {
  let addr = ip.toLowerCase();
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = v4[1].split(".").map(Number);
    const hex = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    addr = addr.slice(0, -v4[1].length) + hex;
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = addr.includes("::") ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, "0")).join(":");
}

function validateName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new ServerTableError("Server name is required");
  if (name.length > SERVER_NAME_MAX) throw new ServerTableError(`Server name must be at most ${SERVER_NAME_MAX} characters`);
  return name;
}

function validateIp(raw: unknown): { ip: string; version: 4 | 6 } {
  const s = typeof raw === "string" ? raw : "";
  if (!s.trim()) throw new ServerTableError("IP address is required");
  const parsed = normalizeIp(s);
  if (!parsed) throw new ServerTableError(`Invalid IP address: ${s.trim()}`);
  return parsed;
}

function validateNote(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new ServerTableError("Note must be a string");
  const note = raw.trim();
  if (note.length > SERVER_NOTE_MAX) throw new ServerTableError(`Note must be at most ${SERVER_NOTE_MAX} characters`);
  return note || undefined;
}

export async function listServers(): Promise<ServerEntry[]> {
  const raw = (await redis.get<ServerEntry[]>(KEYS.servers)) ?? [];
  const list = Array.isArray(raw) ? raw : [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

async function saveServers(list: ServerEntry[]): Promise<void> {
  await redis.set(KEYS.servers, JSON.stringify(list));
}

/** Find a server by id or (case-insensitive) name. */
export async function findServer(idOrName: string): Promise<ServerEntry | null> {
  const list = await listServers();
  const q = idOrName.trim();
  return list.find((s) => s.id === q) ?? list.find((s) => nameKey(s.name) === nameKey(q)) ?? null;
}

/**
 * Validate a would-be new server exactly like createServer (name, IP, note,
 * unique name) without saving anything. Used for dry runs.
 */
export async function validateNewServer(input: { name?: unknown; ip?: unknown; note?: unknown }): Promise<{ name: string; ip: string; version: 4 | 6; note?: string }> {
  const name = validateName(input.name);
  const { ip, version } = validateIp(input.ip);
  const note = validateNote(input.note);
  const list = await listServers();
  if (list.some((s) => nameKey(s.name) === nameKey(name))) {
    throw new ServerTableError(`A server named "${name}" already exists`, 409);
  }
  return { name, ip, version, ...(note ? { note } : {}) };
}

/** Find a server whose IP equals `ip` (IPv6 compared after expansion). */
export async function findServerByIp(ip: string): Promise<ServerEntry | null> {
  const list = await listServers();
  return list.find((s) => sameIp(s.ip, ip)) ?? null;
}

export async function createServer(input: { name?: unknown; ip?: unknown; note?: unknown }): Promise<ServerEntry> {
  const name = validateName(input.name);
  const { ip, version } = validateIp(input.ip);
  const note = validateNote(input.note);

  const list = await listServers();
  if (list.some((s) => nameKey(s.name) === nameKey(name))) {
    throw new ServerTableError(`A server named "${name}" already exists`, 409);
  }

  const now = new Date().toISOString();
  const entry: ServerEntry = {
    id: randomBytes(8).toString("hex"),
    name,
    ip,
    ipVersion: version,
    ...(note ? { note } : {}),
    createdAt: now,
    updatedAt: now,
  };
  list.push(entry);
  await saveServers(list);
  return entry;
}

/**
 * Update a server identified by id or name. Only provided fields change;
 * pass `note: ""` (or null) to clear the note.
 */
export async function updateServer(
  idOrName: string,
  input: { name?: unknown; ip?: unknown; note?: unknown },
): Promise<ServerEntry> {
  const list = await listServers();
  const q = idOrName.trim();
  let idx = list.findIndex((s) => s.id === q);
  if (idx === -1) idx = list.findIndex((s) => nameKey(s.name) === nameKey(q));
  if (idx === -1) throw new ServerTableError(`Server not found: ${idOrName}`, 404);

  const entry = { ...list[idx] };
  if (input.name !== undefined) {
    const name = validateName(input.name);
    if (list.some((s, i) => i !== idx && nameKey(s.name) === nameKey(name))) {
      throw new ServerTableError(`A server named "${name}" already exists`, 409);
    }
    entry.name = name;
  }
  if (input.ip !== undefined) {
    const { ip, version } = validateIp(input.ip);
    entry.ip = ip;
    entry.ipVersion = version;
  }
  if (input.note !== undefined) {
    const note = validateNote(input.note);
    if (note) entry.note = note;
    else delete entry.note;
  }
  entry.updatedAt = new Date().toISOString();
  list[idx] = entry;
  await saveServers(list);
  return entry;
}

export async function deleteServer(idOrName: string): Promise<ServerEntry> {
  const list = await listServers();
  const q = idOrName.trim();
  let idx = list.findIndex((s) => s.id === q);
  if (idx === -1) idx = list.findIndex((s) => nameKey(s.name) === nameKey(q));
  if (idx === -1) throw new ServerTableError(`Server not found: ${idOrName}`, 404);
  const [removed] = list.splice(idx, 1);
  await saveServers(list);
  return removed;
}
