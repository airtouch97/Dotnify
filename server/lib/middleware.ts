import { createMiddleware } from "hono/factory";
import { getSession, extractBearerToken } from "./auth.js";
import { unauthorized } from "./response.js";
import type { AuthedVariables } from "./types.js";

/**
 * Hono middleware that validates the Bearer token against Redis and
 * attaches the session + token to the context. Responds 401 if missing/invalid.
 */
export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) return unauthorized(c, "Missing or invalid Authorization header");
  const session = await getSession(token);
  if (!session) return unauthorized(c, "Session expired or invalid");
  c.set("session", session);
  c.set("token", token);
  await next();
});
