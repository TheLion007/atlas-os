// Copies the local database folder to a dated folder and keeps the 7 most recent copies.
// Refuses to run while the app (or anything else) has the database open.
// Usage: node scripts/db-backup.mjs [destinationRoot]   (default: $ATLAS_BACKUP_DIR or D:/backups/atlas)
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { acquireDbLock } from "./db-lock.mjs";

const KEEP = 7;
const dataDir = resolve(process.env.ATLAS_DB_DIR || "data/atlas-pgdata");
const root = resolve(process.argv[2] || process.env.ATLAS_BACKUP_DIR || "D:/backups/atlas");

try {
  // Holding the lock during the copy also stops the app from starting mid-copy.
  acquireDbLock(dataDir);
} catch (e) {
  console.error(`Backup refused: ${e.message}`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const target = join(root, `atlas-${stamp}`);

mkdirSync(root, { recursive: true });
cpSync(dataDir, target, { recursive: true, errorOnExist: true });

const copies = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^atlas-\d{8}-\d{6}$/.test(e.name))
  .map((e) => e.name)
  .sort();
for (const old of copies.slice(0, Math.max(0, copies.length - KEEP))) {
  rmSync(join(root, old), { recursive: true, force: true });
  console.log(`Removed old copy: ${old}`);
}
console.log(`Backup written: ${target} (${Math.min(copies.length, KEEP)} kept)`);
