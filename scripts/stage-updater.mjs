// Puts electron-updater and everything it needs (its runtime dependency tree) in
// `.updater-stage/node_modules`, which electron-builder ships as `resources/updater/node_modules`
// (see electron-builder.yml). The Electron shell archive holds no node_modules on purpose (the
// Next server brings its own), so the updater travels as a plain folder, like the server does.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const stage = join(root, ".updater-stage", "node_modules");
rmSync(join(root, ".updater-stage"), { recursive: true, force: true });

const seen = new Set();
function walk(name, from) {
  let manifest;
  try {
    manifest = require.resolve(`${name}/package.json`, { paths: [from] });
  } catch {
    return; // optional dependency that is not installed on this platform
  }
  const dir = dirname(manifest);
  if (seen.has(dir)) return;
  seen.add(dir);
  const json = JSON.parse(readFileSync(manifest, "utf8"));
  for (const dep of Object.keys(json.dependencies ?? {})) walk(dep, dir);
}
walk("electron-updater", root);

let copied = 0;
for (const dir of seen) {
  const rel = relative(join(root, "node_modules"), dir);
  // A package nested inside another one travels with its parent.
  if (rel.split(sep).length > 1 && rel.includes(`${sep}node_modules${sep}`)) continue;
  cpSync(dir, join(stage, rel), { recursive: true, dereference: true });
  copied += 1;
}
if (!existsSync(join(stage, "electron-updater", "package.json"))) {
  console.error("electron-updater was not staged.");
  process.exit(1);
}
console.log(`Staged ${copied} package(s) for the updater in .updater-stage`);
