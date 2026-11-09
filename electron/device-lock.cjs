"use strict";

/**
 * A simple lock on the data folder, so two PCs sharing it through a cloud folder do not write at
 * the same time. While Atlas OS is open it keeps `atlas.lock` in the data folder up to date with
 * the device's name and the time (every 30 s). Another PC that finds a lock younger than 2
 * minutes is warned; an older one is considered abandoned (a crash, a closed laptop).
 */
const fs = require("node:fs");
const path = require("node:path");

const LOCK_FILE = "atlas.lock";
const STALE_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

function createDeviceLock({
  root,
  device,
  token,
  pid = process.pid,
  now = () => Date.now(),
  alive = processAlive,
}) {
  const file = path.join(root, LOCK_FILE);

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof raw !== "object" || !raw || typeof raw.updatedAt !== "number")
        return { corrupt: true };
      return raw;
    } catch (e) {
      return e && e.code === "ENOENT" ? null : { corrupt: true };
    }
  }

  function write(since) {
    fs.mkdirSync(root, { recursive: true });
    const body = JSON.stringify({ device, pid, token, since, updatedAt: now() });
    fs.writeFileSync(`${file}.${pid}.part`, body);
    fs.renameSync(`${file}.${pid}.part`, file);
  }

  let since = now();

  return {
    file,
    /**
     * What a start-up finds: `free` (no lock), `ours`, `stale` (abandoned: take it), or `held` by
     * another device that has it open right now (with who).
     */
    inspect() {
      const lock = read();
      if (lock === null) return { state: "free" };
      if (lock.corrupt) return { state: "stale", holder: null };
      if (lock.token === token) return { state: "ours", holder: lock };
      const age = now() - lock.updatedAt;
      // on the same PC, a holder whose process is gone is not holding anything
      if (lock.device === device && typeof lock.pid === "number" && !alive(lock.pid))
        return { state: "stale", holder: lock };
      if (age > STALE_MS) return { state: "stale", holder: lock };
      return { state: "held", holder: lock, ageMs: age };
    },
    /** Takes the lock (also when forcing). */
    acquire() {
      since = now();
      write(since);
    },
    /** Keeps it fresh. Returns what it found: `ours`, `taken` (someone else wrote it) or `gone`. */
    refresh() {
      const lock = read();
      if (lock === null) {
        write(since);
        return { state: "gone" };
      }
      if (!lock.corrupt && lock.token !== token) return { state: "taken", holder: lock };
      write(since);
      return { state: "ours" };
    },
    /** Lets go, only if it is ours. */
    release() {
      const lock = read();
      if (lock && !lock.corrupt && lock.token === token) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* already gone */
        }
      }
    },
  };
}

module.exports = { createDeviceLock, LOCK_FILE, STALE_MS, HEARTBEAT_MS };
