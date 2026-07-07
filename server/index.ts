import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { rateLimit } from "./lib/rate-limit.js";
import auth from "./routes/auth.js";
import providers from "./routes/providers.js";
import zones from "./routes/zones.js";

const app = new Hono();

// Security headers
app.use("/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

// Global rate limit for all API routes (60 requests / minute per IP).
// Stricter per-route limits (e.g. login/setup at 10/min) are applied inside those routes.
app.use("/api/*", rateLimit({ windowSeconds: 60, maxAttempts: 60, keyPrefix: "dotnify:ratelimit:api" }));

// Limit request body size to 2 MB for API routes (import can be large)
app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413) }));

// Global error handler
app.onError((err, c) => {
  console.error("[server] unhandled error:", err);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

// API routes
app.route("/api/auth", auth);
app.route("/api/providers", providers);
app.route("/api/zones", zones);

export default app;
