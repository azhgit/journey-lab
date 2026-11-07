// CLAUDE-OWNED (M10). The viewer app. Dev: `npm run viewer:api` and `npm run viewer:dev` (proxies /api to 4020).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4020" } },
  build: { outDir: "dist", emptyOutDir: true },
});
