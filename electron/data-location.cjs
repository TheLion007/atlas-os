"use strict";

/**
 * Where Atlas OS keeps its data, chosen by the person.
 *
 * `location.json`, in the user's own AppData folder, stays on the device: it holds the chosen data
 * folder and the automatic-backup settings. The data folder holds `data/atlas-pgdata` (the
 * database, documents included), `preferences.json` (the interface preferences, so a second PC
 * pointing at the same folder looks the same), `sauvegardes/` and the device lock `atlas.lock`.
 * A cloud folder (OneDrive, Dropbox, Google Drive, Syncthing…) therefore keeps two PCs in step.
 */
const fs = require("node:fs");
const path = require("node:path");

const CONFIG = "location.json";
const DB_REL = path.join("data", "atlas-pgdata");
/** What moves with the database when the data folder changes. */
const COMPANIONS = ["preferences.json", "sauvegardes"];

function readConfig(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userData, CONFIG), "utf8"));
    return {
      dataRoot: typeof raw.dataRoot === "string" && raw.dataRoot ? raw.dataRoot : null,
      autoBackup: {
        enabled: !!raw.autoBackup?.enabled,
        folder: typeof raw.autoBackup?.folder === "string" ? raw.autoBackup.folder : null,
        lastDay: typeof raw.autoBackup?.lastDay === "string" ? raw.autoBackup.lastDay : null,
        lastPath: typeof raw.autoBackup?.lastPath === "string" ? raw.autoBackup.lastPath : null,
        lastError: typeof raw.autoBackup?.lastError === "string" ? raw.autoBackup.lastError : null,
      },
    };
  } catch {
    return {
      dataRoot: null,
      autoBackup: { enabled: false, folder: null, lastDay: null, lastPath: null, lastError: null },
    };
  }
}

function writeConfig(userData, config) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, CONFIG);
  fs.writeFileSync(`${file}.part`, JSON.stringify(config, null, 2));
  fs.renameSync(`${file}.part`, file);
}

/** The data folder in use: the person's choice, or the default (the user's AppData folder). */
function resolveRoots(userData, config) {
  const dataRoot = config.dataRoot || userData;
  return { dataRoot, dbDir: path.join(dataRoot, DB_REL), isCustom: !!config.dataRoot };
}

/** Can Atlas OS write to this folder? Tries for real: a folder that looks fine may be read-only. */
function checkWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.atlas-write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.code) || "error", message: e && e.message };
  }
}

/** What a folder already holds: Atlas OS data, nothing, or other things. */
function inspectTarget(dir) {
  const hasData = fs.existsSync(path.join(dir, DB_REL, "PG_VERSION"));
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((n) => !n.startsWith(".atlas-write-test"));
  } catch {
    /* does not exist yet */
  }
  return { exists: fs.existsSync(dir), hasData, empty: entries.length === 0 };
}

const norm = (p) =>
  path
    .resolve(p)
    .toLowerCase()
    .replace(/[\\/]+$/, "");
const inside = (child, parent) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
};

/** A target must be a real, different folder, not inside the current data nor containing it. */
function validateTarget(target, current) {
  if (!target || !path.isAbsolute(target)) return { ok: false, reason: "not_absolute" };
  if (norm(target) === norm(current)) return { ok: false, reason: "same" };
  if (inside(target, current) || inside(current, target)) return { ok: false, reason: "nested" };
  if (path.parse(target).root.toLowerCase() === norm(target) + path.sep)
    return { ok: false, reason: "drive_root" };
  return { ok: true };
}

function sizeOf(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        files += 1;
        bytes += fs.statSync(p).size;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

/** Copies the database and what goes with it into another data folder, and checks the copy. */
function copyData(fromRoot, toRoot, onProgress = () => {}) {
  const src = path.join(fromRoot, DB_REL);
  const dst = path.join(toRoot, DB_REL);
  if (fs.existsSync(src)) {
    onProgress("database", 10);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true, errorOnExist: false, force: true });
    const a = sizeOf(src);
    const b = sizeOf(dst);
    if (a.files !== b.files || a.bytes !== b.bytes)
      throw Object.assign(new Error("The copy does not match the original."), {
        code: "COPY_MISMATCH",
      });
  }
  onProgress("companions", 80);
  for (const name of COMPANIONS) {
    const from = path.join(fromRoot, name);
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(toRoot, name), { recursive: true, force: true });
  }
  onProgress("done", 100);
}

/** Removes the data of a data folder after it has been moved (only what Atlas OS put there). */
function removeData(root) {
  fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
  for (const name of COMPANIONS) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  fs.rmSync(path.join(root, "pending-import.json"), { force: true });
}

const stamp = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

/**
 * Applies a change of data folder.
 *   move     the current data is copied to the new folder, checked, then removed from the old one;
 *            the new folder must hold no Atlas OS data (nothing there is overwritten)
 *   use      the new folder is used as it is: its data if it has some, a fresh start if it is empty
 *            (the second PC pointing at a folder that is already full)
 *   replace  like move, for a new folder that already holds data: that data is first set aside in
 *            a `data.avant-remplacement-<date>` folder, never deleted
 */
function applyLocation(userData, { target, mode, now = new Date() }, onProgress = () => {}) {
  const config = readConfig(userData);
  const { dataRoot: current } = resolveRoots(userData, config);
  const valid = validateTarget(target, current);
  if (!valid.ok) return { ok: false, code: valid.reason };
  const writable = checkWritable(target);
  if (!writable.ok) return { ok: false, code: "not_writable", detail: writable.reason };
  const t = inspectTarget(target);

  if (mode === "use") {
    writeConfig(userData, { ...config, dataRoot: target });
    return { ok: true, mode, hadData: t.hasData };
  }
  if (mode !== "move" && mode !== "replace") return { ok: false, code: "bad_mode" };
  if (t.hasData && mode === "move") return { ok: false, code: "target_has_data" };

  let setAside = null;
  try {
    if (t.hasData && mode === "replace") {
      setAside = path.join(target, `data.avant-remplacement-${stamp(now)}`);
      fs.renameSync(path.join(target, "data"), setAside);
    }
    copyData(current, target, onProgress);
  } catch (e) {
    // the old data was not touched; undo what was started in the new folder
    try {
      fs.rmSync(path.join(target, DB_REL), { recursive: true, force: true });
      if (setAside) fs.renameSync(setAside, path.join(target, "data"));
    } catch {
      /* best effort */
    }
    return { ok: false, code: "copy_failed", detail: e && e.message };
  }
  writeConfig(userData, { ...config, dataRoot: target });
  removeData(current);
  return { ok: true, mode, setAside };
}

module.exports = {
  CONFIG,
  DB_REL,
  readConfig,
  writeConfig,
  resolveRoots,
  checkWritable,
  inspectTarget,
  validateTarget,
  copyData,
  removeData,
  applyLocation,
  sizeOf,
};
