import { Hono } from "hono";
import { getAdmin, extractBearerToken, getSession, createSession, verifyPassword, destroySession, hashPassword, setAdmin } from "../lib/auth.js";
import { ok, error, unauthorized } from "../lib/response.js";
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

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, username }
 */
auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return unauthorized(c, "Username and password required");
  }

  const admin = await getAdmin();
  if (!admin) {
    return unauthorized(c, "Admin not initialized");
  }

  if (admin.username !== username) {
    return unauthorized(c, "Invalid credentials");
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
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
auth.post("/setup", async (c) => {
  const existing = await getAdmin();
  if (existing) {
    return error(c, "Admin already initialized", 409);
  }

  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password ?? "";

  if (!username || username.length < 3) {
    return error(c, "Username must be at least 3 characters");
  }
  if (password.length < 8) {
    return error(c, "Password must be at least 8 characters");
  }

  const passwordHash = await hashPassword(password);
  const admin: Admin = {
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await setAdmin(admin);

  return ok(c, { username, createdAt: admin.createdAt }, 201);
});

export default auth;
