"use strict";

/**
 * The interface preferences (theme, sounds, mascot, timer sessions, assistant choice) live in the
 * window's localStorage. To follow the data folder, and to be part of a backup, they are mirrored
 * in `preferences.json` there. A device applies the file at start-up when it is newer than what it
 * last applied (see preload.cjs); an import writes it too.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = "preferences.json";

const file = (root) => path.join(root, FILE);

function readSnapshot(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(root), "utf8"));
    if (!raw || typeof raw.savedAt !== "string" || typeof raw.keys !== "object" || !raw.keys)
      return null;
    const keys = {};
    for (const [k, v] of Object.entries(raw.keys)) if (typeof v === "string") keys[k] = v;
    return { savedAt: raw.savedAt, keys };
  } catch {
    return null;
  }
}

/** Writes the snapshot when the keys changed. Returns the (new or unchanged) `savedAt`. */
function saveSnapshot(root, keys, now = new Date()) {
  const current = readSnapshot(root);
  if (current && JSON.stringify(current.keys) === JSON.stringify(keys)) return current.savedAt;
  const savedAt = now.toISOString();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(`${file(root)}.part`, JSON.stringify({ savedAt, keys }, null, 2));
  fs.renameSync(`${file(root)}.part`, file(root));
  return savedAt;
}

/** For an import: the backup's preferences become the snapshot (stamped now, so they apply). */
function writeImported(root, prefs, now = new Date()) {
  const before = readSnapshot(root);
  if (prefs && prefs.keys) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      file(root),
      JSON.stringify({ savedAt: now.toISOString(), keys: prefs.keys }, null, 2),
    );
  }
  return {
    restore() {
      if (before) fs.writeFileSync(file(root), JSON.stringify(before, null, 2));
      else fs.rmSync(file(root), { force: true });
    },
  };
}

module.exports = { FILE, readSnapshot, saveSnapshot, writeImported };
