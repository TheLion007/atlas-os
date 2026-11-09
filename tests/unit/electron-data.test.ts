import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Real temp folders only: nothing here touches anyone's data. */
const require = createRequire(import.meta.url);
const location = require("../../electron/data-location.cjs");
const { createDeviceLock, STALE_MS } = require("../../electron/device-lock.cjs");
const { applyPendingImport } = require("../../electron/pending-import.cjs");
const autoBackup = require("../../electron/auto-backup.cjs");
const prefsSync = require("../../electron/prefs-sync.cjs");

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "atlas-electron-test-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const fresh = (name: string) => {
  const dir = join(tmp, `${name}-${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** A data folder with a database-looking folder of a few files inside. */
const withData = (root: string, content = "v1") => {
  const db = join(root, "data", "atlas-pgdata");
  mkdirSync(join(db, "base"), { recursive: true });
  writeFileSync(join(db, "PG_VERSION"), "17");
  writeFileSync(join(db, "base", "file1"), content);
  writeFileSync(join(db, "base", "file2"), content + content);
  writeFileSync(join(root, "preferences.json"), "{}");
  return db;
};

describe("two instances on the same data folder: the device lock", () => {
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("lets the first one in, and warns the second one with the first one's name", () => {
    const root = fresh("lock");
    const c = clock();
    const a = createDeviceLock({
      root,
      device: "PC-SALON",
      token: "a",
      pid: 111,
      now: c.now,
      alive: () => true,
    });
    const b = createDeviceLock({
      root,
      device: "PC-BUREAU",
      token: "b",
      pid: 222,
      now: c.now,
      alive: () => true,
    });
    expect(a.inspect().state).toBe("free");
    a.acquire();
    const seen = b.inspect();
    expect(seen.state).toBe("held");
    expect(seen.holder.device).toBe("PC-SALON");
    expect(existsSync(join(root, "atlas.lock"))).toBe(true);
  });

  it("keeps the lock alive with regular updates, and treats it as abandoned after 2 minutes", () => {
    const root = fresh("lock");
    const c = clock();
    const a = createDeviceLock({
      root,
      device: "A",
      token: "a",
      pid: 1,
      now: c.now,
      alive: () => true,
    });
    const b = createDeviceLock({
      root,
      device: "B",
      token: "b",
      pid: 2,
      now: c.now,
      alive: () => true,
    });
    a.acquire();
    c.advance(STALE_MS - 1000);
    expect(b.inspect().state).toBe("held");
    expect(a.refresh().state).toBe("ours"); // the heartbeat
    c.advance(STALE_MS - 1000);
    expect(b.inspect().state).toBe("held"); // still fresh thanks to the refresh
    c.advance(STALE_MS + 1000); // the PC went to sleep: no more updates
    const stale = b.inspect();
    expect(stale.state).toBe("stale");
    expect(stale.holder.device).toBe("A");
    b.acquire(); // taking an abandoned lock needs no question
    expect(b.inspect().state).toBe("ours");
  });

  it("is released when the app closes, and only by its owner", () => {
    const root = fresh("lock");
    const c = clock();
    const a = createDeviceLock({
      root,
      device: "A",
      token: "a",
      pid: 1,
      now: c.now,
      alive: () => true,
    });
    const b = createDeviceLock({
      root,
      device: "B",
      token: "b",
      pid: 2,
      now: c.now,
      alive: () => true,
    });
    a.acquire();
    b.release(); // not b's lock: nothing happens
    expect(existsSync(join(root, "atlas.lock"))).toBe(true);
    a.release();
    expect(existsSync(join(root, "atlas.lock"))).toBe(false);
    expect(b.inspect().state).toBe("free");
  });

  it("notices when another device forced its way in while this one was open", () => {
    const root = fresh("lock");
    const c = clock();
    const a = createDeviceLock({
      root,
      device: "A",
      token: "a",
      pid: 1,
      now: c.now,
      alive: () => true,
    });
    const b = createDeviceLock({
      root,
      device: "B",
      token: "b",
      pid: 2,
      now: c.now,
      alive: () => true,
    });
    a.acquire();
    b.acquire(); // forced
    const r = a.refresh();
    expect(r.state).toBe("taken");
    expect(r.holder.device).toBe("B");
  });

  it("is not held by a process that no longer exists on the same PC, and survives a damaged file", () => {
    const root = fresh("lock");
    const c = clock();
    const dead = createDeviceLock({
      root,
      device: "PC",
      token: "x",
      pid: 99,
      now: c.now,
      alive: () => true,
    });
    dead.acquire();
    const again = createDeviceLock({
      root,
      device: "PC",
      token: "y",
      pid: 100,
      now: c.now,
      alive: () => false,
    });
    expect(again.inspect().state).toBe("stale");
    writeFileSync(join(root, "atlas.lock"), "{{{ not json");
    expect(again.inspect().state).toBe("stale");
    again.acquire();
    expect(again.inspect().state).toBe("ours");
  });
});

describe("changing the data folder", () => {
  const setup = () => {
    const userData = fresh("userdata");
    const db = withData(userData, "mes-donnees");
    return { userData, db };
  };

  it("uses the default folder until one is chosen, and remembers the choice on this device", () => {
    const userData = fresh("userdata");
    const cfg = location.readConfig(userData);
    expect(cfg.dataRoot).toBeNull();
    expect(location.resolveRoots(userData, cfg)).toMatchObject({
      dataRoot: userData,
      isCustom: false,
    });
    location.writeConfig(userData, { ...cfg, dataRoot: join(tmp, "ailleurs") });
    const again = location.readConfig(userData);
    expect(location.resolveRoots(userData, again)).toMatchObject({
      dataRoot: join(tmp, "ailleurs"),
      isCustom: true,
    });
    expect(existsSync(join(userData, "location.json"))).toBe(true);
  });

  it("moves the existing data to the new folder: checked copy, switch, then the old one is removed", () => {
    const { userData } = setup();
    const target = fresh("cloud");
    const r = location.applyLocation(userData, { target, mode: "move" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(target, "data", "atlas-pgdata", "base", "file1"), "utf8")).toBe(
      "mes-donnees",
    );
    expect(readFileSync(join(target, "data", "atlas-pgdata", "base", "file2"), "utf8")).toBe(
      "mes-donneesmes-donnees",
    );
    expect(existsSync(join(target, "preferences.json"))).toBe(true);
    expect(location.readConfig(userData).dataRoot).toBe(target);
    expect(existsSync(join(userData, "data"))).toBe(false); // moved, not copied
  });

  it("never overwrites data that is already in the target when asked to move", () => {
    const { userData } = setup();
    const target = fresh("cloud");
    withData(target, "autre-pc");
    const r = location.applyLocation(userData, { target, mode: "move" });
    expect(r).toMatchObject({ ok: false, code: "target_has_data" });
    expect(readFileSync(join(target, "data", "atlas-pgdata", "base", "file1"), "utf8")).toBe(
      "autre-pc",
    );
    expect(existsSync(join(userData, "data", "atlas-pgdata"))).toBe(true); // nothing lost here either
    expect(location.readConfig(userData).dataRoot).toBeNull();
  });

  it("second PC: uses the data that is already in the folder, leaving everything as it is", () => {
    const { userData } = setup();
    const target = fresh("cloud");
    withData(target, "du-premier-pc");
    expect(location.inspectTarget(target).hasData).toBe(true);
    const r = location.applyLocation(userData, { target, mode: "use" });
    expect(r).toMatchObject({ ok: true, hadData: true });
    expect(location.readConfig(userData).dataRoot).toBe(target);
    expect(readFileSync(join(target, "data", "atlas-pgdata", "base", "file1"), "utf8")).toBe(
      "du-premier-pc",
    );
    expect(existsSync(join(userData, "data", "atlas-pgdata"))).toBe(true); // this PC's own data is kept too
  });

  it("replace: sets the target's data aside (never deleted) and puts this PC's data in", () => {
    const { userData } = setup();
    const target = fresh("cloud");
    withData(target, "a-remplacer");
    const r = location.applyLocation(userData, { target, mode: "replace" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(target, "data", "atlas-pgdata", "base", "file1"), "utf8")).toBe(
      "mes-donnees",
    );
    expect(r.setAside).toBeTruthy();
    expect(readFileSync(join(r.setAside, "atlas-pgdata", "base", "file1"), "utf8")).toBe(
      "a-remplacer",
    );
  });

  it("refuses a folder it cannot write to, the same folder, or one nested in the current data", () => {
    const { userData } = setup();
    expect(location.applyLocation(userData, { target: userData, mode: "move" })).toMatchObject({
      ok: false,
      code: "same",
    });
    expect(
      location.applyLocation(userData, { target: join(userData, "data", "sub"), mode: "move" }),
    ).toMatchObject({ ok: false, code: "nested" });
    expect(
      location.applyLocation(userData, { target: "relatif/dossier", mode: "move" }),
    ).toMatchObject({ ok: false, code: "not_absolute" });
    // a path under a regular file cannot be created: not writable
    const file = join(tmp, "un-fichier.txt");
    writeFileSync(file, "x");
    expect(
      location.applyLocation(userData, { target: join(file, "sous"), mode: "move" }),
    ).toMatchObject({ ok: false, code: "not_writable" });
    expect(location.checkWritable(file).ok).toBe(false);
    expect(location.checkWritable(fresh("ok")).ok).toBe(true);
    expect(location.readConfig(userData).dataRoot).toBeNull();
    expect(existsSync(join(userData, "data", "atlas-pgdata", "PG_VERSION"))).toBe(true);
  });
});

describe("finishing a replacement import at start-up", () => {
  const prepare = () => {
    const root = fresh("imp");
    const dbDir = join(root, "data", "atlas-pgdata");
    withData(root, "ancien");
    const staging = `${dbDir}.import-staging`;
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "PG_VERSION"), "17");
    writeFileSync(join(staging, "marker"), "nouveau");
    writeFileSync(
      join(root, "pending-import.json"),
      JSON.stringify({
        staging,
        safetyBackup: join(root, "securite.atlasbackup"),
        prefs: { savedAt: "2026-01-01T00:00:00Z", keys: { "atlas-prefs": "{}" } },
      }),
    );
    return { root, dbDir, staging };
  };

  it("swaps the new data in, keeps the old beside it until the new one runs, then lets it go", () => {
    const { root, dbDir } = prepare();
    const r = applyPendingImport(root, dbDir, (p: { keys: Record<string, string> }) =>
      prefsSync.writeImported(root, p),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dbDir, "marker"), "utf8")).toBe("nouveau");
    expect(existsSync(`${dbDir}.before-import`)).toBe(true);
    expect(existsSync(join(root, "pending-import.json"))).toBe(false); // handled: never applied twice
    expect(prefsSync.readSnapshot(root).keys["atlas-prefs"]).toBe("{}");
    r.commit();
    expect(existsSync(`${dbDir}.before-import`)).toBe(false);
  });

  it("puts the previous data back exactly if the new data does not come up", () => {
    const { root, dbDir } = prepare();
    const r = applyPendingImport(root, dbDir, () => null);
    r.rollback();
    expect(readFileSync(join(dbDir, "base", "file1"), "utf8")).toBe("ancien");
    expect(existsSync(join(dbDir, "marker"))).toBe(false);
    expect(existsSync(`${dbDir}.before-import`)).toBe(false);
  });

  it("does nothing when nothing is waiting, and leaves the old data alone when the staged data is gone", () => {
    const root = fresh("imp");
    expect(applyPendingImport(root, join(root, "data", "atlas-pgdata"), () => null)).toBeNull();
    const { root: r2, dbDir, staging } = prepare();
    rmSync(staging, { recursive: true, force: true });
    expect(applyPendingImport(r2, dbDir, () => null)).toMatchObject({
      ok: false,
      reason: "staging_missing",
    });
    expect(readFileSync(join(dbDir, "base", "file1"), "utf8")).toBe("ancien");
  });
});

describe("the automatic backup folder", () => {
  const make = (folder: string, days: string[], extra: string[] = []) => {
    for (const d of days)
      writeFileSync(join(folder, `AtlasOS-sauvegarde-auto-${d}.atlasbackup`), "x");
    for (const e of extra) writeFileSync(join(folder, e), "keep me");
  };

  it("keeps only the 7 newest automatic backups, and never touches anything else", () => {
    const folder = fresh("auto");
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    make(folder, days, [
      "AtlasOS-sauvegarde-2026-11-01.atlasbackup",
      "photos.zip",
      "AtlasOS-sauvegarde-auto-2026-11-03.atlasbackup.part",
    ]);
    const removed = autoBackup.rotate(folder, 7);
    expect(removed).toEqual([
      "AtlasOS-sauvegarde-auto-2026-11-01.atlasbackup",
      "AtlasOS-sauvegarde-auto-2026-11-02.atlasbackup",
      "AtlasOS-sauvegarde-auto-2026-11-03.atlasbackup",
    ]);
    const left = readdirSync(folder).sort();
    expect(left.filter((f) => autoBackup.NAME.test(f))).toHaveLength(7);
    expect(left).toContain("photos.zip");
    expect(left).toContain("AtlasOS-sauvegarde-2026-11-01.atlasbackup"); // a manual export is never removed
    expect(left).toContain("AtlasOS-sauvegarde-auto-2026-11-03.atlasbackup.part");
  });

  it("is due once a day, by the files actually there", () => {
    const folder = fresh("auto");
    const day = new Date(2026, 10, 9, 15, 0, 0);
    expect(autoBackup.isDue(folder, day)).toBe(true);
    make(folder, ["2026-11-09"]);
    expect(autoBackup.isDue(folder, day)).toBe(false);
    expect(autoBackup.isDue(folder, new Date(2026, 10, 10, 8, 0, 0))).toBe(true);
    expect(autoBackup.isDue(null, day)).toBe(false);
    expect(autoBackup.autoBackupName(day)).toBe("AtlasOS-sauvegarde-auto-2026-11-09.atlasbackup");
  });

  it("does not fail on a folder that has disappeared", () => {
    expect(autoBackup.rotate(join(tmp, "n-existe-pas"), 7)).toEqual([]);
  });
});

describe("the preferences that follow the data folder", () => {
  it("are mirrored in the folder only when they change", () => {
    const root = fresh("prefs");
    expect(prefsSync.readSnapshot(root)).toBeNull();
    const first = prefsSync.saveSnapshot(
      root,
      { "atlas-prefs": "a" },
      new Date("2026-11-01T10:00:00Z"),
    );
    const same = prefsSync.saveSnapshot(
      root,
      { "atlas-prefs": "a" },
      new Date("2026-11-02T10:00:00Z"),
    );
    expect(same).toBe(first); // unchanged: not rewritten
    const next = prefsSync.saveSnapshot(
      root,
      { "atlas-prefs": "b" },
      new Date("2026-11-03T10:00:00Z"),
    );
    expect(next > first).toBe(true);
    expect(prefsSync.readSnapshot(root)).toEqual({ savedAt: next, keys: { "atlas-prefs": "b" } });
  });

  it("an import can be taken back: the previous preferences are restored", () => {
    const root = fresh("prefs");
    prefsSync.saveSnapshot(root, { "atlas-prefs": "avant" });
    const imported = prefsSync.writeImported(root, { keys: { "atlas-prefs": "importé" } });
    expect(prefsSync.readSnapshot(root).keys["atlas-prefs"]).toBe("importé");
    imported.restore();
    expect(prefsSync.readSnapshot(root).keys["atlas-prefs"]).toBe("avant");
  });
});
