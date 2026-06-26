import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { devApi } from "./scripts/vite-plugin-dev-api";

export default defineConfig(({ mode }) => {
  // Load .env / .env.local / .env.[mode] and inject non-VITE_ vars into
  // process.env so the API functions (loaded via ssrLoadModule) can see
  // UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v;
  }

  return {
    plugins: [react(), devApi()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
    },
  };
});
