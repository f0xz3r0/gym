import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// In development the studio API runs separately (just assets_studio studio).
const studio = "http://127.0.0.1:9000";

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // the classic studio (index.html) was retired 2026-11-12: .local/archive/2026-11-12/classic-ui
    rollupOptions: { input: { flow: "flow.html", pipeline: "pipeline.html" } },
  },
  server: {
    proxy: {
      "/api": studio,
      "/mcp": studio,
      "/flow-api": "http://127.0.0.1:9001",
    },
  },
});
