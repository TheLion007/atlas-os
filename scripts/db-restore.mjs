// Restores a backup copy into the database folder. The current folder is not deleted: it is
// renamed to `<dir>.before-restore-<timestamp>` so a wrong restore can be undone.
// Usage: node scripts/db-restore.mjs <backupFolder>
import { cpSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { acquireDbLock } from "./db-lock.mjs";

const source = process.argv[2] && resolve(process.argv[2]);
if (!source || !existsSync(source)) {
  console.error("Usage: node scripts/db-restore.mjs <backupFolder>   (a folder made by db:backup)");
  process.exit(1);
}
if (!existsSync(resolve(source, "PG_VERSION"))) {
  console.error("Restore refused: that folder does not look like a database copy (no PG_VERSION).");
  process.exit(1);
}
const dataDir = resolve(process.env.ATLAS_DB_DIR || "data/atlas-pgdata");

try {
  acquireDbLock(dataDir);
} catch (e) {
  console.error(`Restore refused: ${e.message}`);
  process.exit(1);
}

if (existsSync(dataDir)) {
  const aside = `${dataDir}.before-restore-${Date.now()}`;
  renameSync(dataDir, aside);
  console.log(`Current database kept at: ${aside}`);
}
cpSync(source, dataDir, { recursive: true });
console.log(`Restored ${source} -> ${dataDir}`);
