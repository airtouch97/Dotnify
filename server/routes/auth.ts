import { Hono } from "hono";
import { getAdmin, extractBearerToken, getSession, createSession, verifyPassword, destroySession, hashPassword, createAdmin } from "../lib/auth.js";
import { ok, error, unauthorized } from "../lib/response.js";
import { rateLimit } from "../lib/rate-limit.js";
import type { Admin } from "../lib/types.js";

const auth = new Hono();

/**
 * GET /api/auth/me
 * Returns the current session + whether admin has been initialized.
 * Public endpoint (used by the frontend before login to decide /setup vs /login).
 */
auth.get("/me", async (c) => {
  const admin = await getAdmin();

  if (!admin) {
    return ok(c, { setupRequired: true, authenticated: false, username: null });
  }

  const token = extractBearerToken(c.req.header("authorization"));
  const session = token ? await getSession(token) : null;

  if (!session) {
    return ok(c, {
      setupRequired: false,
      authenticated: false,
      username: null,
    });
  }

  return ok(c, {
    setupRequired: false,
    authenticated: true,
    username: session.username,
  });
});

// A dummy scrypt hash used to ensure verifyPassword always runs, even when
// the username doesn't match, preventing timing-based username enumeration.
const DUMMY_HASH = "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, username }
 */
auth.post("/login", rateLimit(), async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return unauthorized(c, "Username and password required");
  }
  if (password.length > 128) {
    return error(c, "Password too long");
  }

  const admin = await getAdmin();
  // Always run verifyPassword to prevent timing-based username enumeration.
  // If admin doesn't exist or username doesn't match, verify against a dummy hash.
  const hashToVerify = admin && admin.username === username
    ? admin.passwordHash
    : DUMMY_HASH;

  const valid = await verifyPassword(password, hashToVerify);

  if (!admin || admin.username !== username || !valid) {
    return unauthorized(c, "Invalid credentials");
  }

  const token = await createSession(admin.username);
  return ok(c, { token, username: admin.username });
});

/**
 * POST /api/auth/logout
 * Invalidates the current Bearer token in Redis.
 */
auth.post("/logout", async (c) => {
  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) return ok(c, { loggedOut: true }); // idempotent

  await destroySession(token);
  return ok(c, { loggedOut: true });
});

/**
 * POST /api/auth/setup
 * First-time admin creation. Only available when no admin exists yet.
 * Body: { username, password }
 */
auth.post("/setup", rateLimit(), async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password ?? "";

  if (!username || username.length < 3) {
    return error(c, "Username must be at least 3 characters");
  }
  if (username.length > 64) {
    return error(c, "Username too long");
  }
  if (password.length < 8) {
    return error(c, "Password must be at least 8 characters");
  }
  if (password.length > 128) {
    return error(c, "Password too long");
  }

  const passwordHash = await hashPassword(password);
  const admin: Admin = {
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  const created = await createAdmin(admin);
  if (!created) {
    return error(c, "Admin already initialized", 409);
  }

  return ok(c, { username, createdAt: admin.createdAt }, 201);
});

export default auth;
