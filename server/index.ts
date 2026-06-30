import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import auth from "./routes/auth.js";
import providers from "./routes/providers.js";
import zones from "./routes/zones.js";

const app = new Hono();

// Global error handler
app.onError((err, c) => {
  console.error("[server] unhandled error:", err);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

// API routes
app.route("/api/auth", auth);
app.route("/api/providers", providers);
app.route("/api/zones", zones);

// Production: serve static files
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ root: "./dist", path: "index.html" })); // SPA fallback

export default app;
