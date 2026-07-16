import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    exclude: ["node_modules/**"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/repositories/mock/**/*.ts"],
      exclude: ["**/__tests__/**", "**/fixtures.ts"],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
