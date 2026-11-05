// Same lock protocol as src/server/db/pglite.ts: `<dataDir>.lock` holds the pid of the process
// that has the database open. Used by every script that reads or writes the data folder.
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** The pid of the process holding the database, or null if it is free (stale locks are ignored). */
export function lockHolder(dataDir) {
  const lockPath = `${dataDir}.lock`;
  if (!existsSync(lockPath)) return null;
  const pid = Number(readFileSync(lockPath, "utf8").trim());
  return pid && pid !== process.pid && alive(pid) ? pid : null;
}

/** Takes the lock for this script's lifetime; throws if the app (or another script) has it. */
export function acquireDbLock(dataDir) {
  const holder = lockHolder(dataDir);
  if (holder) {
    throw new Error(
      `The database is in use by another process (pid ${holder}). Stop the app first.`,
    );
  }
  const lockPath = `${dataDir}.lock`;
  if (existsSync(lockPath)) unlinkSync(lockPath);
  const fd = openSync(lockPath, "wx");
  writeSync(fd, String(process.pid));
  closeSync(fd);
  const release = () => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      release();
      process.exit(1);
    });
  }
  return release;
}
