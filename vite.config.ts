import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { devApi } from "./scripts/vite-plugin-dev-api";

export default defineConfig(({ mode }) => {
  // Load .env / .env.local and inject non-VITE_ vars into process.env
  // so the server code (loaded via ssrLoadModule) can see them.
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
      port: 3000,
    },
  };
});
