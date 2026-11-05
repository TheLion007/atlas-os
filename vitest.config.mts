import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/support/dom-setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/sql/**/*.test.ts",
      "tests/api/**/*.test.ts",
      "tests/real/**/*.test.ts",
    ],
    // SQL tests boot an in-process Postgres (PGlite) and apply every migration.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { provider: "v8", include: ["src/domain/**"] },
  },
});
