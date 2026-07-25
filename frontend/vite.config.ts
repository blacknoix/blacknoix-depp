import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Local same-origin proxy avoids CORS and keeps the browser from talking to
 * the gateway host directly. Production should sit behind a reverse proxy
 * that serves this UI and /v1 on one origin — CORS on api-gateway is deferred.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
