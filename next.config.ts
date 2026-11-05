import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app embeds the built server (see scripts/build-server.mjs): a self-contained
  // folder with the traced dependencies. The web build is unchanged.
  ...(process.env.ATLAS_DESKTOP_BUILD === "1" ? { output: "standalone" as const } : {}),
  // The server reads files by path at run time (migrations, the data folder), which makes the
  // tracer pull in whole project folders. Nothing personal or developer-only may ride along into
  // the desktop build: the local database, backups, screenshots, tests, docs, tooling.
  outputFileTracingExcludes: {
    "*": [
      "data/**",
      "backup/**",
      "screenshots/**",
      "tests/**",
      "docs/**",
      "scripts/**",
      "release/**",
      "electron/**",
      "build/**",
      ".claude/**",
      ".env*",
      "**/*.lock",
    ],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite loads its WASM files from disk, so it must stay out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
