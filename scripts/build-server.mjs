// Builds the Atlas OS server for the desktop app: `next build` in "standalone" mode, then the two
// folders Next leaves out of it (static files and public assets) are put beside it, so
// `.next/standalone/server.js` runs on its own.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const env = {
  ...process.env,
  ATLAS_DESKTOP_BUILD: "1",
  // The installed app is never the demo, and never reads a developer's local .env files for it.
  NEXT_PUBLIC_ATLAS_FIXTURES: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

rmSync(join(root, ".next", "standalone"), { recursive: true, force: true });
const build = spawnSync(
  process.execPath,
  [join(root, "node_modules", "next", "dist", "bin", "next"), "build"],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const standalone = join(root, ".next", "standalone");
if (!existsSync(join(standalone, "server.js"))) {
  console.error("The standalone server was not produced (.next/standalone/server.js is missing).");
  process.exit(1);
}
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public")))
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });

// Turbopack points its packages-outside-the-bundle at the build machine's node_modules with
// symbolic links (.next/node_modules/<name>-<hash>). On another PC those links lead nowhere, so
// each one is replaced by a real copy of what it pointed to.
const linked = join(standalone, ".next", "node_modules");
let replaced = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) {
      const target = realpathSync(path);
      rmSync(path, { recursive: true, force: true });
      cpSync(target, path, { recursive: true, dereference: true });
      replaced += 1;
    } else if (lstatSync(path).isDirectory()) walk(path);
  }
}
if (existsSync(linked)) walk(linked);
console.log(`Replaced ${replaced} linked package(s) with real copies.`);
console.log("Server ready in .next/standalone");
