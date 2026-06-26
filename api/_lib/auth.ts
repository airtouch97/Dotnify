import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { redis, KEYS } from "./redis";
import type { Admin, Session } from "./types";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Upstash SDK auto-deserializes JSON-looking strings into objects by default,
 * so redis.get may return either the raw JSON string or an already-parsed
 * object. Normalize both into a typed value.
 */
function parseStored<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

/** Hash a password with a fresh salt, returning `scrypt:<salt_hex>:<hash_hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify a password against a stored `scrypt:<salt_hex>:<hash_hex>` string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

/** Create a session token, store it in Redis with 7-day TTL, return the token. */
export async function createSession(username: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const session: Session = { username, createdAt: new Date().toISOString() };
  await redis.set(KEYS.session(token), JSON.stringify(session), {
    ex: SESSION_TTL_SECONDS,
  });
  return token;
}

/** Look up a session by token. Returns null if missing/expired. */
export async function getSession(token: string): Promise<Session | null> {
  const raw = await redis.get<unknown>(KEYS.session(token));
  return parseStored<Session>(raw);
}

/** Delete a session token (logout). */
export async function destroySession(token: string): Promise<void> {
  await redis.del(KEYS.session(token));
}

/** Get the admin record, or null if not yet set up. */
export async function getAdmin(): Promise<Admin | null> {
  const raw = await redis.get<unknown>(KEYS.admin);
  return parseStored<Admin>(raw);
}

/** Persist the admin record (only used by /api/auth/setup). */
export async function setAdmin(admin: Admin): Promise<void> {
  await redis.set(KEYS.admin, JSON.stringify(admin));
}

/** Extract a bearer token from the Authorization header. */
export function extractBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || typeof auth !== "string") return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
