// `npm run dist:smoke`: starts the built app (release/win-unpacked) twice on a throw-away data
// folder, never on the real one. Run 1 creates a project; run 2 checks it is still there. Each run
// also reports what the window sees: title, version, data folder, the local database, the Ollama
// bridge, and that a request to the internet is blocked.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const built = resolve(process.argv[2] || join("release", "win-unpacked", "Atlas OS.exe"));
if (!existsSync(built)) {
  console.error(`Not found: ${built}. Build first (npm run dist:dir).`);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "atlas-smoke-"));
// Run a COPY placed outside the project: next to the project, Node would find its node_modules and
// hide anything the packaged app forgot to bring along.
cpSync(dirname(built), join(dir, "app"), { recursive: true });
const exe = join(dir, "app", basename(built));

function run(label, extra = {}) {
  const out = join(dir, `${label}.json`);
  const r = spawnSync(exe, [`--smoke-test=${out}`], {
    env: { ...process.env, ATLAS_USER_DATA_DIR: join(dir, "AtlasOS"), ...extra },
    timeout: 120_000,
    stdio: "ignore",
  });
  if (!existsSync(out))
    throw new Error(`${label}: no result (exit ${r.status}). See ${join(dir, "AtlasOS", "logs")}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

const first = run("first", { ATLAS_SMOKE_CREATE: "Projet de test (smoke)" });
console.log("FIRST RUN", JSON.stringify(first, null, 2));
const second = run("second");
console.log("SECOND RUN", JSON.stringify(second, null, 2));

const checks = {
  windowTitle: first.title === "Atlas OS",
  pageLoaded: !!first.page?.href?.startsWith("http://127.0.0.1:"),
  versionKnown: !!first.page?.desktop?.version,
  dataInAppData:
    /Atlas OS$/.test(first.page?.desktop?.dataDir ?? "") ||
    first.page?.desktop?.dataDir?.startsWith(join(dir, "AtlasOS")),
  databaseStartedEmpty: first.page?.graph?.nodes === 0,
  projectCreated: first.create?.status === 201 || first.create?.status === 200,
  dataKeptAfterRestart: second.page?.graph?.nodes >= 1,
  internetBlocked: first.page?.external === "blocked",
  ollamaBridgeAnswers: typeof first.page?.ollama?.reachable === "boolean",
};
console.log("CHECKS", JSON.stringify(checks, null, 2));
rmSync(dir, { recursive: true, force: true });
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
