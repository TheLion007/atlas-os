import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEdgeAllowed } from "@/domain/edge-rules";
import {
  DATA_KINDS,
  DEPENDENCY_TYPES,
  EDGE_KINDS,
  ESTIMATE_CATEGORIES,
  ESTIMATE_UNITS,
  EVENT_KINDS,
  LIFECYCLE_STATUSES,
  LOCATION_LEVELS,
  OBJECT_TYPES,
  SCENARIO_VARIANTS,
} from "@/domain/enums";
import {
  OWNER,
  PG,
  createMigratedDb,
  createObject,
  expectPgError,
  inRollback,
  insertObject,
  migrationFiles,
} from "./helpers";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("are timestamp-named and ordered", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("enable row level security on every public table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("give every table an owner column so policies are uniform", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and t.table_name not in ('edge_rules')
         and not exists (select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'owner_id')`,
    );
    expect(rows).toEqual([]);
  });

  it("never store derived values (no progress, level, slip or yield columns)", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and column_name in ('progress', 'level', 'risk_level', 'slip_days', 'yield', 'blocked',
                             'backlinks', 'critical_path', 'scheduled_date')
         -- location_details.level is the geographic level (country, city, ...), not a risk level.
         and not (table_name = 'location_details' and column_name = 'level')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("enums stay in sync with src/domain/enums.ts", () => {
  const cases: [string, readonly string[]][] = [
    ["object_type", OBJECT_TYPES],
    ["lifecycle_status", LIFECYCLE_STATUSES],
    ["edge_kind", EDGE_KINDS],
    ["data_kind", DATA_KINDS],
    ["scenario_variant", SCENARIO_VARIANTS],
    ["dependency_type", DEPENDENCY_TYPES],
    ["estimate_category", ESTIMATE_CATEGORIES],
    ["estimate_unit", ESTIMATE_UNITS],
    ["location_level", LOCATION_LEVELS],
    ["event_kind", EVENT_KINDS],
  ];
  it.each(cases)("%s", async (name, values) => {
    const { rows } = await db.query<{ v: string }>(
      `select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder`,
      [name],
    );
    expect(rows.map((r) => r.v)).toEqual([...values]);
  });
});

describe("edge_rules table matches the TypeScript matrix", () => {
  it("agrees on every (kind, from, to) combination", async () => {
    const { rows } = await db.query<{ kind: string; from_type: string; to_type: string }>(
      "select kind, from_type, to_type from public.edge_rules",
    );
    const sql = new Set(rows.map((r) => `${r.kind}|${r.from_type}|${r.to_type}`));
    const mismatches: string[] = [];
    for (const kind of EDGE_KINDS)
      for (const from of OBJECT_TYPES)
        for (const to of OBJECT_TYPES) {
          const inSql = sql.has(`${kind}|${from}|${to}`);
          if (inSql !== isEdgeAllowed(kind, from, to)) mismatches.push(`${kind} ${from}->${to}`);
        }
    expect(mismatches).toEqual([]);
  });
});

describe("objects (spine)", () => {
  it("creates an object of every type with its details", async () => {
    await inRollback(db, async (tx) => {
      for (const type of OBJECT_TYPES) {
        const id = await createObject(tx, { type });
        const { rows } = await tx.query("select 1 from public.objects where id = $1", [id]);
        expect(rows).toHaveLength(1);
      }
    });
  });

  it("defaults status to active and tags to empty", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "task" });
      const { rows } = await tx.query<{ status: string; tags: string[] }>(
        "select status, tags from public.objects where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({ status: "active", tags: [] });
    });
  });

  it("rejects a blank title and an out-of-range confidence", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(insertObject(tx, { type: "task", title: "   " }), PG.check);
    });
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.query(
          `insert into public.objects (type, title, confidence, owner_id) values ('task', 'x', 101, $1)`,
          [OWNER],
        ),
        PG.check,
      );
    });
  });

  it("refuses to change an object's type or owner", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "task" });
      await expectPgError(
        tx.query("update public.objects set type = 'project' where id = $1", [id]),
        PG.check,
        /immutable/,
      );
    });
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "task" });
      await expectPgError(
        tx.query("update public.objects set owner_id = $2 where id = $1", [
          id,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ]),
        PG.check,
        /immutable/,
      );
    });
  });

  it("bumps updated_at on change", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "task" });
      await tx.exec(
        `update public.objects set updated_at = now() - interval '1 day' where id = '${id}'`,
      );
      await tx.exec(`update public.objects set title = 'renamed' where id = '${id}'`);
      const { rows } = await tx.query<{ fresh: boolean }>(
        "select updated_at > now() - interval '1 minute' as fresh from public.objects where id = $1",
        [id],
      );
      expect(rows[0]?.fresh).toBe(true);
    });
  });

  it("supports full-text and fuzzy title search", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        `insert into public.objects (type, title, search_text, owner_id)
         values ('property', 'Dorsel Marina Apartment', 'sea view balcony', $1)`,
        [OWNER],
      );
      const fts = await tx.query(
        "select 1 from public.objects where search @@ to_tsquery('simple', 'balcony')",
      );
      expect(fts.rows).toHaveLength(1);
      const fuzzy = await tx.query(
        "select 1 from public.objects where title operator(extensions.%) 'Dorsel Marna Apartment'",
      );
      expect(fuzzy.rows).toHaveLength(1);
    });
  });
});

describe("details tables prove they belong to the right object", () => {
  it("rejects details of the wrong type", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "project" });
      await expectPgError(
        tx.exec(`insert into public.task_details (id, owner_id) values ('${id}', '${OWNER}')`),
        PG.foreignKey,
      );
    });
  });

  it("rejects details owned by someone other than the object's owner", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "task" });
      await expectPgError(
        tx.exec(
          `insert into public.task_details (id, owner_id) values ('${id}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')`,
        ),
        PG.foreignKey,
      );
    });
  });

  it("cascades: hard-deleting an object removes its details", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "task" });
      await tx.exec(`delete from public.objects where id = '${id}'`);
      const { rows } = await tx.query("select 1 from public.task_details where id = $1", [id]);
      expect(rows).toHaveLength(0);
    });
  });
});

describe("project details", () => {
  const insertProject = (tx: Parameters<typeof insertObject>[0], type: string, extra: string) =>
    insertObject(tx, { type }).then((id) =>
      tx.exec(
        `insert into public.project_details (id, type, owner_id, ${extra.split("|")[0]})
         values ('${id}', '${type}', '${OWNER}', ${extra.split("|")[1]})`,
      ),
    );

  it("accepts a project with a budget", async () => {
    await inRollback(db, async (tx) => {
      await insertProject(tx, "project", "budget_amount, budget_currency|420000, 'EUR'");
    });
  });

  it("requires budget amount and currency together", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(insertProject(tx, "project", "budget_amount|10"), PG.check);
    });
  });

  it("forbids a budget on a sub-project", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        insertProject(tx, "sub_project", "budget_amount, budget_currency|1, 'EUR'"),
        PG.check,
      );
    });
  });

  it("rejects a target date before the start date and a bad priority", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        insertProject(tx, "project", "start_date, target_date|'2027-01-01', '2026-01-01'"),
        PG.check,
      );
    });
    await inRollback(db, async (tx) => {
      await expectPgError(insertProject(tx, "project", "priority|5"), PG.check);
    });
  });
});

describe("estimate details", () => {
  const est = (tx: Parameters<typeof insertObject>[0], cols: string, vals: string) =>
    insertObject(tx, { type: "estimate" }).then((id) =>
      tx.exec(
        `insert into public.estimate_details (id, owner_id, ${cols}) values ('${id}', '${OWNER}', ${vals})`,
      ),
    );

  it("requires a currency for monetary units", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(est(tx, "amount", "100"), PG.check);
    });
  });

  it("forbids a currency on non-monetary units", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(est(tx, "amount, unit, currency", "20, 'percent', 'EUR'"), PG.check);
    });
  });

  it("accepts a percent assumption without a currency", async () => {
    await inRollback(db, async (tx) => {
      await est(tx, "amount, unit, data_kind", "20, 'percent', 'assumption'");
    });
  });

  it("rejects a malformed currency code", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(est(tx, "amount, currency", "1, 'eur'"), PG.check);
    });
  });

  it("will not delete a scenario that estimates still belong to", async () => {
    await inRollback(db, async (tx) => {
      const scenario = await createObject(tx, { type: "scenario" });
      const id = await insertObject(tx, { type: "estimate" });
      await tx.exec(
        `insert into public.estimate_details (id, owner_id, amount, currency, scenario_id)
         values ('${id}', '${OWNER}', 1, 'EUR', '${scenario}')`,
      );
      await expectPgError(
        tx.exec(`delete from public.scenario_details where id = '${scenario}'`),
        PG.restrict,
      );
    });
  });
});

describe("location details are generic", () => {
  const loc = (tx: Parameters<typeof insertObject>[0], cols: string, vals: string) =>
    insertObject(tx, { type: "location" }).then((id) =>
      tx.exec(
        `insert into public.location_details (id, owner_id, ${cols}) values ('${id}', '${OWNER}', ${vals})`,
      ),
    );

  it("allows an unplaced location (no coordinates is honest, not an error)", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "location" });
    });
  });

  it("stores places in any country with the same structure", async () => {
    await inRollback(db, async (tx) => {
      await loc(
        tx,
        "country_code, city, lat, lng, coordinates_source",
        "'AE', 'Dorsel', 25.0805, 55.1403, 'manual'",
      );
      await loc(
        tx,
        "country_code, city, lat, lng, coordinates_source",
        "'BE', 'Bremont', 50.8503, 4.3517, 'manual'",
      );
    });
  });

  it("requires latitude and longitude together", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(loc(tx, "lat", "25.0"), PG.check);
    });
  });

  it("rejects out-of-range coordinates and bad country codes", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(loc(tx, "lat, lng", "91, 0"), PG.check);
    });
    await inRollback(db, async (tx) => {
      await expectPgError(loc(tx, "lat, lng", "0, 181"), PG.check);
    });
    await inRollback(db, async (tx) => {
      await expectPgError(loc(tx, "country_code", "'be'"), PG.check);
    });
  });
});

describe("decision — no close without a reason", () => {
  const options = `'[{"id":"a","label":"Marina"},{"id":"b","label":"JLT"}]'::jsonb`;

  it("allows an open decision", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "decision" });
    });
  });

  it("rejects a resolved option that is not one of the options", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "decision" });
      await expectPgError(
        tx.exec(
          `insert into public.decision_details (id, owner_id, options, resolved_option_id, rationale)
           values ('${id}', '${OWNER}', ${options}, 'zzz', 'because')`,
        ),
        PG.check,
        /not one of/,
      );
    });
  });

  it("rejects writing details for a closed decision without a rationale", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "decision", status: "done" });
      await expectPgError(
        tx.exec(
          `insert into public.decision_details (id, owner_id, options, resolved_option_id, rationale)
           values ('${id}', '${OWNER}', ${options}, 'a', '   ')`,
        ),
        PG.check,
        /rationale/,
      );
    });
  });

  it("rejects flipping status to done when there is no rationale", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "decision" });
      await tx.exec(
        `insert into public.decision_details (id, owner_id, options, resolved_option_id)
         values ('${id}', '${OWNER}', ${options}, 'a')`,
      );
      await expectPgError(
        tx.exec(`update public.objects set status = 'done' where id = '${id}'`),
        PG.check,
        /rationale/,
      );
    });
  });

  it("rejects flipping status to done when no option was chosen", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "decision" });
      await expectPgError(
        tx.exec(`update public.objects set status = 'done' where id = '${id}'`),
        PG.check,
        /resolved option/,
      );
    });
  });

  it("closes cleanly with an option and a rationale", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "decision" });
      await tx.exec(
        `insert into public.decision_details (id, owner_id, options, resolved_option_id, rationale)
         values ('${id}', '${OWNER}', ${options}, 'a', 'Best yield at acceptable risk.')`,
      );
      await tx.exec(`update public.objects set status = 'done' where id = '${id}'`);
      const { rows } = await tx.query<{ status: string }>(
        "select status from public.objects where id = $1",
        [id],
      );
      expect(rows[0]?.status).toBe("done");
    });
  });

  it("blocks blanking the rationale of an already-closed decision", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "decision" });
      await tx.exec(
        `insert into public.decision_details (id, owner_id, options, resolved_option_id, rationale)
         values ('${id}', '${OWNER}', ${options}, 'a', 'reason')`,
      );
      await tx.exec(`update public.objects set status = 'done' where id = '${id}'`);
      await expectPgError(
        tx.exec(`update public.decision_details set rationale = '' where id = '${id}'`),
        PG.check,
        /rationale/,
      );
    });
  });
});

describe("risk details", () => {
  it.each([
    [0, 3],
    [3, 0],
    [6, 3],
    [3, 6],
  ])("rejects probability %i / impact %i", async (p, i) => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "risk" });
      await expectPgError(
        tx.exec(
          `insert into public.risk_details (id, owner_id, probability, impact) values ('${id}', '${OWNER}', ${p}, ${i})`,
        ),
        PG.check,
      );
    });
  });
});

describe("supporting tables", () => {
  it("requires an explicit base currency (no hard-coded default)", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.exec(`insert into public.app_settings (owner_id) values ('${OWNER}')`),
        PG.notNull,
      );
    });
  });

  it("rejects an inverted timeline window", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.exec(
          `insert into public.app_settings (owner_id, base_currency, timeline_start, timeline_end)
           values ('${OWNER}', 'EUR', '2032-01-01', '2026-01-01')`,
        ),
        PG.check,
      );
    });
  });

  it("requires every FX rate to name its source and be positive", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.exec(
          `insert into public.fx_rates (owner_id, from_ccy, to_ccy, rate, as_of, source)
           values ('${OWNER}', 'EUR', 'AED', 4.0, '2026-09-21', '  ')`,
        ),
        PG.check,
      );
    });
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.exec(
          `insert into public.fx_rates (owner_id, from_ccy, to_ccy, rate, as_of, source)
           values ('${OWNER}', 'EUR', 'AED', 0, '2026-09-21', 'manual')`,
        ),
        PG.check,
      );
    });
  });

  it("does not allow the same rate twice for a date", async () => {
    await inRollback(db, async (tx) => {
      const ins = `insert into public.fx_rates (owner_id, from_ccy, to_ccy, rate, as_of, source)
                   values ('${OWNER}', 'EUR', 'AED', 4.0, '2026-09-21', 'manual')`;
      await tx.exec(ins);
      await expectPgError(tx.exec(ins), PG.unique);
    });
  });
});
