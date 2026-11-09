import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as collection from "@/app/api/objects/route";
import * as exportRoute from "@/app/api/backup/export/route";
import { exportBackup } from "@/server/backup/export";
import { currentJob, startExport, startImport, type JobState } from "@/server/backup/jobs";
import { inspectBackup, openBackupDatabase, readBackupFile } from "@/server/backup/load";
import { mergeBackup } from "@/server/backup/merge";
import { BACKUP_FORMAT, countDatabase, itemTotal } from "@/server/backup/manifest";
import { buildZip, readZip } from "@/server/backup/zip";
import { latestSchemaVersion } from "@/server/db/pglite";
import { asOwner } from "@/server/db/types";
import { createObject, parseCreateObjectBody } from "@/server/objects/service";
import { insertEdge } from "@/server/objects/edges";
import { call, createApiHarness, pgliteDb, type ApiHarness } from "../support/pglite-db";
import { createMigratedDb } from "../sql/helpers";

/** Throw-away in-memory databases and a temp folder: nothing here touches anyone's data. */
const OWNER = "94e3e13a-ee19-40ae-8a7d-6087a1db84c6";
let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "atlas-backup-test-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const make = async (
  pg: PGlite,
  type: string,
  title: string,
  details: Record<string, unknown> = {},
  status = "active",
) => {
  const { object } = parseCreateObjectBody({ type, title, status, details });
  return (await createObject(pgliteDb(pg), OWNER, object)).id;
};
const link = (pg: PGlite, kind: string, from: string, to: string) =>
  asOwner(pgliteDb(pg), OWNER, (tx) =>
    insertEdge(tx, OWNER, {
      kind,
      from,
      to,
      label: null,
      dependencyType: null,
      lagDays: null,
    } as never),
  );
const addFile = (pg: PGlite, path: string, text: string) =>
  pg.query(
    "insert into public.document_files (owner_id, storage_path, mime, size_bytes, checksum, bytes) values ($1,$2,'text/plain',$3,'x',$4)",
    [OWNER, path, text.length, new TextEncoder().encode(text)],
  );
const titles = async (pg: PGlite) =>
  (
    await pg.query<{ title: string }>(
      "select title from public.objects where deleted_at is null order by title",
    )
  ).rows.map((r) => r.title);

/** A workspace with a bit of everything: a plan, projects, tasks, a note, a document with its file. */
async function workspace(): Promise<{ pg: PGlite; ids: Record<string, string> }> {
  const pg = await createMigratedDb();
  const plan = await make(pg, "plan", "Feuille de route");
  const project = await make(pg, "project", "Refonte du site");
  const sub = await make(pg, "sub_project", "Pages produit");
  const task = await make(pg, "task", "Maquettes", {}, "done");
  const note = await make(pg, "note", "Idées");
  const doc = await make(pg, "document", "Contrat", {
    mime: "text/plain",
    storagePath: "files/a/contrat.txt",
    sizeBytes: 11,
    originalName: "contrat.txt",
  });
  await addFile(pg, "files/a/contrat.txt", "bonjour doc");
  await link(pg, "contains", plan, project);
  await link(pg, "contains", project, sub);
  await link(pg, "contains", sub, task);
  await link(pg, "references", doc, project);
  return { pg, ids: { plan, project, sub, task, note, doc } };
}

const exportTo = (pg: PGlite, name: string, prefs: Record<string, string> = {}) =>
  exportBackup(pg, {
    outPath: join(tmp, name),
    device: "PC-TEST",
    appVersion: "1.0.3",
    prefs,
  });

describe("the zip container", () => {
  it("round-trips entries, compressed or stored, with names in any language", () => {
    const big = Buffer.from("a".repeat(5000));
    const zip = buildZip([
      { name: "manifest.json", data: Buffer.from('{"a":1}') },
      { name: "documents/Facture été – n°1.pdf", data: big },
      { name: "database/x.gz", data: Buffer.from([1, 2, 3, 4]), compress: false },
    ]);
    const z = readZip(zip);
    expect(z.entries.map((e) => e.name)).toEqual([
      "manifest.json",
      "documents/Facture été – n°1.pdf",
      "database/x.gz",
    ]);
    expect(z.read("documents/Facture été – n°1.pdf").equals(big)).toBe(true);
    expect([...z.read("database/x.gz")]).toEqual([1, 2, 3, 4]);
    expect(zip.length).toBeLessThan(5000); // the big one was deflated
  });

  it("refuses what is not a zip, and what has been damaged", () => {
    expect(() => readZip(Buffer.from("this is not a zip file at all, just text"))).toThrow();
    expect(() => readZip(Buffer.alloc(10))).toThrow();
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("hello hello hello hello") }]);
    const bad = Buffer.from(zip);
    bad[40] = bad[40]! ^ 0xff; // flip a byte inside the data
    expect(() => readZip(bad).read("a.txt")).toThrow();
    expect(() => readZip(zip.subarray(0, zip.length - 30))).toThrow(); // cut off
  });
});

describe("exporting", () => {
  it("writes one .atlasbackup holding the manifest, the database, the preferences and readable documents", async () => {
    const { pg } = await workspace();
    const r = await exportTo(pg, "complet.atlasbackup", {
      "atlas-prefs": '{"state":{"theme":"dark"}}',
      "atlas-timer": "{}",
    });
    const z = readZip(readFileSync(r.path));
    const names = z.entries.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "database/pgdata.tar.gz",
        "preferences.json",
        "documents/contrat.txt",
      ]),
    );
    expect(z.read("documents/contrat.txt").toString()).toBe("bonjour doc");
    const m = JSON.parse(z.read("manifest.json").toString());
    expect(m).toMatchObject({
      format: BACKUP_FORMAT,
      app: "Atlas OS",
      appVersion: "1.0.3",
      device: "PC-TEST",
      kind: "manual",
    });
    expect(m.schemaVersion).toBe(latestSchemaVersion());
    expect(m.counts).toMatchObject({
      plans: 1,
      projects: 1,
      subProjects: 1,
      tasks: 1,
      notes: 1,
      documents: 1,
      links: 4,
      preferences: 2,
    });
    expect(m.counts.workHistory).toBeGreaterThan(0);
    expect(m.databaseSha256).toBe(
      createHash("sha256").update(z.read("database/pgdata.tar.gz")).digest("hex"),
    );
    expect(existsSync(`${r.path}.part`)).toBe(false); // no half-written file left behind
    expect(JSON.parse(z.read("preferences.json").toString()).keys["atlas-prefs"]).toContain("dark");
  });

  it("reports its progress from start to finish", async () => {
    const { pg } = await workspace();
    const seen: number[] = [];
    await exportBackup(
      pg,
      { outPath: join(tmp, "p.atlasbackup"), device: "d", appVersion: "1" },
      (_p, pct) => seen.push(pct),
    );
    expect(seen[0]).toBeLessThan(10);
    expect(seen[seen.length - 1]).toBe(100);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});

describe("export, then import on a brand-new installation", () => {
  it("restores everything: items, links, the work history, documents with their files", async () => {
    const { pg: source } = await workspace();
    const file = (await exportTo(source, "round.atlasbackup")).path;
    const sourceCounts = await countDatabase(source);

    const info = await inspectBackup(file);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.counts).toMatchObject({ projects: 1, tasks: 1, documents: 1, links: 4 });
    expect(itemTotal(info.counts)).toBe(itemTotal(sourceCounts));

    // replace: the backup's database becomes the database of a blank installation
    const dir = join(tmp, "blank-pgdata");
    const loaded = readBackupFile(file);
    const staged = await openBackupDatabase(loaded, dir);
    await staged.close();
    const reopened = new PGlite(dir, { extensions: { pg_trgm } });
    await reopened.waitReady;
    expect(await countDatabase(reopened)).toEqual(sourceCounts);
    expect(await titles(reopened)).toEqual(await titles(source));
    const f = await reopened.query<{ bytes: Uint8Array }>(
      "select bytes from public.document_files where storage_path = 'files/a/contrat.txt'",
    );
    expect(new TextDecoder().decode(f.rows[0]!.bytes)).toBe("bonjour doc");
    // the structure is intact: no orphan edge
    const orphans = await reopened.query<{ n: number }>(
      `select count(*)::int n from public.edges e left join public.objects f on f.id = e.from_id left join public.objects t on t.id = e.to_id
        where e.deleted_at is null and (f.id is null or t.id is null or f.deleted_at is not null or t.deleted_at is not null)`,
    );
    expect(orphans.rows[0]!.n).toBe(0);
    await reopened.close();

    // merge into a blank installation gives the same thing too
    const blank = await createMigratedDb();
    const backupDb = await openBackupDatabase(loaded);
    const summary = await mergeBackup(blank, backupDb);
    await backupDb.close();
    expect(summary.itemsAdded).toBe(itemTotal(sourceCounts));
    expect(await titles(blank)).toEqual(await titles(source));
    expect((await countDatabase(blank)).links).toBe(sourceCounts.links);
    expect((await countDatabase(blank)).documentBytes).toBe(sourceCounts.documentBytes);
    expect((await countDatabase(blank)).workHistory).toBe(sourceCounts.workHistory);
  });
});

describe("merging with duplicates", () => {
  async function pair() {
    const { pg: a, ids } = await workspace();
    const file = (await exportTo(a, "pair.atlasbackup")).path;
    const b = await createMigratedDb();
    const loaded = readBackupFile(file);
    const copy = await openBackupDatabase(loaded);
    await mergeBackup(b, copy); // b starts as a copy of a (a second PC)
    await copy.close();
    return { a, b, ids };
  }
  const stamp = async (pg: PGlite, id: string, title: string, when: string) => {
    await pg.exec("alter table public.objects disable trigger objects_set_updated_at");
    await pg.query("update public.objects set title = $2, updated_at = $3 where id = $1", [
      id,
      title,
      when,
    ]);
    await pg.exec("alter table public.objects enable trigger objects_set_updated_at");
  };

  it("adds what is missing and keeps the most recent version of what is in both", async () => {
    const { a, b, ids } = await pair();
    // the same project edited on both PCs: the backup's edit is the newer one
    await stamp(a, ids.project!, "Refonte (modifié sur le PC A)", "2030-01-02T00:00:00Z");
    await stamp(b, ids.project!, "Refonte (vieux titre B)", "2030-01-01T00:00:00Z");
    // the same note edited on both: this time B's edit is newer
    await stamp(a, ids.note!, "Idées (ancien)", "2030-03-01T00:00:00Z");
    await stamp(b, ids.note!, "Idées (récent B)", "2030-03-05T00:00:00Z");
    // new things on each side
    await make(a, "task", "Seulement sur A");
    await make(b, "task", "Seulement sur B");
    await addFile(a, "files/a/nouveau.txt", "x");

    const backup = await openBackupDatabase(
      readBackupFile((await exportTo(a, "dup.atlasbackup")).path),
    );
    const before = (await countDatabase(b)).documentBytes;
    const summary = await mergeBackup(b, backup);
    await backup.close();

    const t = await titles(b);
    expect(t).toContain("Refonte (modifié sur le PC A)"); // the newer version came in
    expect(t).not.toContain("Refonte (vieux titre B)");
    expect(t).toContain("Idées (récent B)"); // the newer local version stayed
    expect(t).not.toContain("Idées (ancien)");
    expect(t).toContain("Seulement sur A"); // added
    expect(t).toContain("Seulement sur B"); // untouched
    expect(summary.itemsAdded).toBe(1);
    expect(summary.itemsUpdated).toBe(1);
    expect(summary.itemsKept).toBeGreaterThanOrEqual(4);
    // no duplicate of anything
    const dupes = await b.query<{ n: number }>(
      "select count(*)::int n from (select id from public.objects group by id having count(*) > 1) x",
    );
    expect(dupes.rows[0]!.n).toBe(0);
    expect((await countDatabase(b)).documentBytes).toBe(before + 1); // only the new file came in
  });

  it("merges twice without changing anything the second time", async () => {
    const { a, b } = await pair();
    await make(a, "task", "Nouvelle tâche");
    const file = (await exportTo(a, "twice.atlasbackup")).path;
    const first = await openBackupDatabase(readBackupFile(file));
    await mergeBackup(b, first);
    await first.close();
    const afterFirst = { titles: await titles(b), counts: await countDatabase(b) };
    const second = await openBackupDatabase(readBackupFile(file));
    const summary = await mergeBackup(b, second);
    await second.close();
    expect(summary.itemsAdded).toBe(0);
    expect(summary.itemsUpdated).toBe(0);
    expect(summary.historyAdded).toBe(0);
    expect({ titles: await titles(b), counts: await countDatabase(b) }).toEqual(afterFirst);
  });

  it("changes nothing at all when the merge fails halfway", async () => {
    const { a, b } = await pair();
    await make(a, "task", "Ne doit pas arriver");
    const backup = await openBackupDatabase(
      readBackupFile((await exportTo(a, "half.atlasbackup")).path),
    );
    const before = { titles: await titles(b), counts: await countDatabase(b) };
    await expect(
      mergeBackup(b, backup, (_phase, pct) => {
        if (pct >= 92) throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    await backup.close();
    expect({ titles: await titles(b), counts: await countDatabase(b) }).toEqual(before);
    // the app's own triggers are back on after a failed merge
    const trg = await b.query<{ n: number }>(
      "select count(*)::int n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.proname = 'log_activity' and t.tgenabled = 'D'",
    );
    expect(trg.rows[0]!.n).toBe(0);
  });

  it("does not let two parents or a missing parent break the merge: those links are skipped", async () => {
    const { a, b } = await pair();
    const p2 = await make(a, "project", "Autre projet");
    const sub = (
      await a.query<{ id: string }>("select id from public.objects where title = 'Pages produit'")
    ).rows[0]!.id;
    // in a, the sub-project moves to another parent: in b it still has its old parent
    await a.query(
      "update public.edges set deleted_at = now() where to_id = $1 and kind = 'contains'",
      [sub],
    );
    await link(a, "contains", p2, sub);
    const backup = await openBackupDatabase(
      readBackupFile((await exportTo(a, "parents.atlasbackup")).path),
    );
    const summary = await mergeBackup(b, backup);
    await backup.close();
    expect(summary.skipped).toBeGreaterThanOrEqual(0);
    const parents = await b.query<{ n: number }>(
      "select count(*)::int n from public.edges where to_id = $1 and kind = 'contains' and deleted_at is null",
      [sub],
    );
    expect(parents.rows[0]!.n).toBe(1); // still exactly one parent
  });
});

describe("older and newer backups", () => {
  it("opens a backup made before the latest migrations, and brings it up to date", async () => {
    const files = (await import("node:fs"))
      .readdirSync(join(process.cwd(), "db", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const latest = files[files.length - 1]!;
    const old = await createMigratedDb({ before: latest });
    const proj = await make(old, "project", "Ancien projet");
    expect(proj).toBeTruthy();
    const dump = Buffer.from(await (await old.dumpDataDir("gzip")).arrayBuffer());
    const manifest = {
      format: 1,
      app: "Atlas OS",
      appVersion: "1.0.0",
      schemaVersion: files[files.length - 2]!.slice(0, 14),
      exportedAt: "2026-10-01T10:00:00.000Z",
      device: "VIEUX-PC",
      kind: "manual",
      counts: {},
      databaseSha256: createHash("sha256").update(dump).digest("hex"),
    };
    const file = join(tmp, "ancienne.atlasbackup");
    writeFileSync(
      file,
      buildZip([
        { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
        { name: "database/pgdata.tar.gz", data: dump, compress: false },
      ]),
    );
    const info = await inspectBackup(file);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(info.migrated).toBe(true);
      expect(info.counts.projects).toBe(1);
    }
    const target = await createMigratedDb();
    const db = await openBackupDatabase(readBackupFile(file));
    await mergeBackup(target, db);
    await db.close();
    expect(await titles(target)).toContain("Ancien projet");
  });

  it("refuses a backup made by a newer Atlas OS, with a clear reason", async () => {
    const { pg } = await workspace();
    const r = await exportTo(pg, "future.atlasbackup");
    const z = readZip(readFileSync(r.path));
    const m = JSON.parse(z.read("manifest.json").toString());
    for (const change of [{ format: BACKUP_FORMAT + 1 }, { schemaVersion: "99999999999999" }]) {
      const file = join(tmp, `future-${Object.keys(change)[0]}.atlasbackup`);
      writeFileSync(
        file,
        buildZip([
          { name: "manifest.json", data: Buffer.from(JSON.stringify({ ...m, ...change })) },
          {
            name: "database/pgdata.tar.gz",
            data: z.read("database/pgdata.tar.gz"),
            compress: false,
          },
        ]),
      );
      const info = await inspectBackup(file);
      expect(info).toMatchObject({ ok: false, code: "newer_version" });
    }
  });
});

describe("a corrupted or wrong file", () => {
  it("is refused before anything is touched, with the right reason", async () => {
    const { pg } = await workspace();
    const good = readFileSync((await exportTo(pg, "good.atlasbackup")).path);

    const cases: [string, Buffer, string][] = [
      ["empty", Buffer.alloc(0), "not_a_backup"],
      ["text", Buffer.from("this is not a backup"), "not_a_backup"],
      ["cut off", good.subarray(0, Math.floor(good.length / 2)), "not_a_backup"],
      [
        "zip without manifest",
        buildZip([{ name: "x.txt", data: Buffer.from("x") }]),
        "not_a_backup",
      ],
    ];
    const damaged = Buffer.from(good);
    for (let i = 5000; i < 5040; i++) damaged[i] = damaged[i]! ^ 0xff; // inside the database entry
    cases.push(["damaged inside", damaged, "corrupt"]);
    const notJson = buildZip([
      { name: "manifest.json", data: Buffer.from("{{{ nope") },
      { name: "database/pgdata.tar.gz", data: Buffer.from("x"), compress: false },
    ]);
    cases.push(["manifest is not JSON", notJson, "not_a_backup"]);

    for (const [name, bytes, code] of cases) {
      const file = join(tmp, `bad-${name.replace(/\W+/g, "-")}.atlasbackup`);
      writeFileSync(file, bytes);
      const info = await inspectBackup(file);
      expect(info, name).toMatchObject({ ok: false });
      if (!info.ok) expect(info.code, name).toBe(code);
    }
    // a file that does not exist
    expect(await inspectBackup(join(tmp, "absent.atlasbackup"))).toMatchObject({
      ok: false,
      code: "unreadable_file",
    });

    // a database that is not one: the checksum matches but the engine cannot read it
    const junk = Buffer.from("not a database archive");
    const m = JSON.parse(readZip(good).read("manifest.json").toString());
    writeFileSync(
      join(tmp, "junkdb.atlasbackup"),
      buildZip([
        {
          name: "manifest.json",
          data: Buffer.from(
            JSON.stringify({
              ...m,
              databaseSha256: createHash("sha256").update(junk).digest("hex"),
            }),
          ),
        },
        { name: "database/pgdata.tar.gz", data: junk, compress: false },
      ]),
    );
    expect(await inspectBackup(join(tmp, "junkdb.atlasbackup"))).toMatchObject({
      ok: false,
      code: "unreadable_database",
    });
  });
});

describe("the import job: safety copy first, then replace or merge", () => {
  const wait = async (): Promise<JobState> => {
    for (let i = 0; i < 400; i++) {
      const j = currentJob();
      if (j && j.status !== "running") return j;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("job did not finish");
  };
  const g = globalThis as unknown as {
    __atlasPglite?: Promise<PGlite>;
    __atlasBackupJob?: unknown;
  };
  const root = () => join(tmp, "root");

  beforeEach(() => {
    delete g.__atlasBackupJob;
    process.env.ATLAS_DATA_ROOT = root();
    process.env.ATLAS_DB_DIR = join(root(), "data", "atlas-pgdata");
  });

  it("merge: writes a safety backup of the current data, then adds what is missing", async () => {
    const { pg: other } = await workspace();
    await make(other, "task", "Venue de la sauvegarde");
    const file = (await exportTo(other, "job-merge.atlasbackup")).path;
    const live = await createMigratedDb();
    await make(live, "project", "Déjà là");
    g.__atlasPglite = Promise.resolve(live);

    startImport({ path: file, mode: "merge", prefs: { "atlas-prefs": "{}" } });
    const job = await wait();
    expect(job.status, JSON.stringify(job.error)).toBe("done");
    expect(job.result?.mode).toBe("merge");
    expect(job.result?.summary?.itemsAdded).toBeGreaterThan(0);
    const safety = job.result!.safetyBackup!;
    expect(existsSync(safety)).toBe(true);
    // the safety copy holds the data as it was before: only "Déjà là"
    const before = await inspectBackup(safety);
    expect(before.ok && before.counts.projects).toBe(1);
    expect(before.ok && before.manifest.kind).toBe("safety");
    expect(await titles(live)).toContain("Venue de la sauvegarde");
  });

  it("replace: stages the new data for the next start and leaves the current data alone", async () => {
    const { pg: other } = await workspace();
    const file = (
      await exportTo(other, "job-replace.atlasbackup", {
        "atlas-prefs": '{"state":{"mascot":"moka"}}',
      })
    ).path;
    const live = await createMigratedDb();
    await make(live, "project", "À remplacer");
    g.__atlasPglite = Promise.resolve(live);

    startImport({ path: file, mode: "replace" });
    const job = await wait();
    expect(job.status, JSON.stringify(job.error)).toBe("done");
    expect(job.result).toMatchObject({ mode: "replace", needsRestart: true });
    expect(await titles(live)).toEqual(["À remplacer"]); // not touched until the restart
    const pending = JSON.parse(readFileSync(join(root(), "pending-import.json"), "utf8"));
    expect(existsSync(pending.staging)).toBe(true);
    expect(pending.prefs.keys["atlas-prefs"]).toContain("moka");
    expect(existsSync(pending.safetyBackup)).toBe(true);
    const staged = new PGlite(pending.staging, { extensions: { pg_trgm } });
    await staged.waitReady;
    expect(await titles(staged)).toContain("Refonte du site");
    await staged.close();
  });

  it("a corrupted file stops the import before the safety copy or any change", async () => {
    const live = await createMigratedDb();
    await make(live, "project", "Intact");
    g.__atlasPglite = Promise.resolve(live);
    const bad = join(tmp, "job-bad.atlasbackup");
    writeFileSync(bad, Buffer.from("garbage"));
    // what earlier tests left behind is not this test's business: note it, then compare
    const safetyDir = join(root(), "sauvegardes", "securite");
    const copiesBefore = existsSync(safetyDir) ? readdirSync(safetyDir).length : 0;
    rmSync(join(root(), "pending-import.json"), { force: true });
    startImport({ path: bad, mode: "replace" });
    const job = await wait();
    expect(job.status).toBe("error");
    expect(job.error?.code).toBe("not_a_backup");
    expect(await titles(live)).toEqual(["Intact"]);
    expect(existsSync(join(root(), "pending-import.json"))).toBe(false); // nothing is waiting to be swapped in
    const copiesAfter = existsSync(safetyDir) ? readdirSync(safetyDir).length : 0;
    expect(copiesAfter).toBe(copiesBefore); // not even a safety copy: nothing was touched
  });

  it("export job: appears at the chosen path and reports done", async () => {
    const { pg } = await workspace();
    g.__atlasPglite = Promise.resolve(pg);
    const out = join(tmp, "job-export.atlasbackup");
    startExport({ path: out, prefs: { a: "b" } });
    const job = await wait();
    expect(job.status).toBe("done");
    expect(job.result?.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(job.percent).toBe(100);
  });
});

describe("read-only mode", () => {
  let h: ApiHarness;
  beforeAll(async () => {
    h = await createApiHarness();
  }, 60_000);
  afterAll(async () => {
    delete process.env.ATLAS_READONLY;
    await h.close();
  });

  it("refuses every write but still reads and exports", async () => {
    const user = h.newUser();
    const okCreate = await call(collection.POST, "POST", "/api/objects", {
      user,
      body: { type: "task", title: "ok", details: {} },
    });
    expect(okCreate.status).toBe(201);
    process.env.ATLAS_READONLY = "1";
    const blocked = await call(collection.POST, "POST", "/api/objects", {
      user,
      body: { type: "task", title: "non", details: {} },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("read_only");
    const read = await call(collection.GET, "GET", "/api/objects", { user });
    expect(read.status).toBe(200);
    // copying data out is allowed (it changes nothing)
    const exp = await call(exportRoute.POST, "POST", "/api/backup/export", {
      user,
      body: { path: join(tmp, "ro", "x.txt") },
    });
    expect(exp.status).toBe(400); // reaches the route (bad extension), not blocked as read-only
    delete process.env.ATLAS_READONLY;
  });
});
