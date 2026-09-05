import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true, // enables RTL auto-cleanup between tests
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    env: {
      // Dedicated throwaway SQLite DB for tests (re-created by `npm test`).
      DATABASE_URL: process.env.DATABASE_URL ?? "file:./test.db",
    },
  },
});
