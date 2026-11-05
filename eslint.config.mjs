import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The domain layer is pure: no I/O, no React, no framework, no DB, no app layers.
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "react/*", "react-dom/*"],
              message: "src/domain must stay framework-free.",
            },
            {
              group: ["@/server/*", "@/components/*", "@/app/*", "@/lib/*"],
              message: "src/domain must not depend on other app layers.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests read dynamic JSON response bodies; typing each one would add noise, not safety.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // The desktop shell and the build scripts are plain Node (CommonJS): `require` is how they load.
    files: ["electron/**/*.cjs", "scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "release/**", "coverage/**", "next-env.d.ts"]),
]);
