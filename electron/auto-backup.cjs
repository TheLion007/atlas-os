"use strict";

/**
 * The automatic backup: once a day, a `.atlasbackup` in a folder the person chose, keeping only
 * the 7 newest so the disk does not fill up. Only files that follow this exact naming are ever
 * removed; anything else in the folder is left alone.
 */
const fs = require("node:fs");
const path = require("node:path");

const KEEP = 7;
const NAME = /^AtlasOS-sauvegarde-auto-(\d{4})-(\d{2})-(\d{2})\.atlasbackup$/;

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const autoBackupName = (d) => `AtlasOS-sauvegarde-auto-${dayOf(d)}.atlasbackup`;
const autoBackupPath = (folder, d) => path.join(folder, autoBackupName(d));

/** Is a backup due? One per calendar day, counted by the files actually in the folder. */
function isDue(folder, now) {
  if (!folder) return false;
  return !fs.existsSync(autoBackupPath(folder, now));
}

/** Removes the oldest automatic backups beyond the newest `keep`. Returns what was removed. */
function rotate(folder, keep = KEEP) {
  let names;
  try {
    names = fs.readdirSync(folder).filter((n) => NAME.test(n));
  } catch {
    return [];
  }
  names.sort(); // the date is in the name: oldest first
  const old = names.slice(0, Math.max(0, names.length - keep));
  for (const n of old) fs.rmSync(path.join(folder, n), { force: true });
  return old;
}

module.exports = { KEEP, NAME, autoBackupName, autoBackupPath, isDue, rotate, dayOf };
