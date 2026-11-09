"use strict";

/**
 * Replacing the data with a backup is finished here, at start-up, before the database is opened
 * (the server staged the new database and wrote `pending-import.json`). The swap is two renames;
 * the old data stays beside the new until the new one has come up, and is put back if it does not.
 */
const fs = require("node:fs");
const path = require("node:path");

const PENDING = "pending-import.json";

function readPending(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, PENDING), "utf8"));
    return raw && typeof raw.staging === "string" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Swaps the staged database in. Returns null when nothing is pending, or
 * `{ ok: false, reason }` when it cannot (the old data is untouched), or `{ ok: true, commit,
 * rollback }`: call `commit` once the new data runs, `rollback` if it does not.
 */
function applyPendingImport(root, dbDir, writePrefs) {
  const pending = readPending(root);
  if (!pending) return null;
  const file = path.join(root, PENDING);
  if (!fs.existsSync(pending.staging)) {
    fs.rmSync(file, { force: true });
    return { ok: false, reason: "staging_missing" };
  }
  const previous = `${dbDir}.before-import`;
  let movedOld = false;
  try {
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(dbDir)) {
      fs.renameSync(dbDir, previous);
      movedOld = true;
    }
    fs.mkdirSync(path.dirname(dbDir), { recursive: true });
    fs.renameSync(pending.staging, dbDir);
  } catch (e) {
    // put the old data back exactly where it was
    try {
      if (movedOld && !fs.existsSync(dbDir)) fs.renameSync(previous, dbDir);
    } catch {
      /* nothing more can be done */
    }
    return { ok: false, reason: "swap_failed", detail: e && e.message };
  }
  const prefsBackup = writePrefs ? writePrefs(pending.prefs) : null;
  fs.renameSync(file, path.join(root, "last-import.json"));
  return {
    ok: true,
    safetyBackup: pending.safetyBackup,
    commit() {
      // the new data runs: the old copy is no longer needed (the safety backup file remains)
      fs.rmSync(previous, { recursive: true, force: true });
    },
    rollback() {
      fs.rmSync(dbDir, { recursive: true, force: true });
      if (movedOld) fs.renameSync(previous, dbDir);
      if (prefsBackup && prefsBackup.restore) prefsBackup.restore();
    },
  };
}

module.exports = { applyPendingImport, readPending, PENDING };
