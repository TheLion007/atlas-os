// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { DataSourceError, type AtlasDataSource } from "@/client/data-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { axeViolations } from "../../../tests/support/a11y";
import { i18nCtx } from "../../../tests/support/i18n";
import { describeActivity, humanize } from "./activity";
import { CommandCenter } from "./CommandCenter";
import { exampleSeed } from "@tests/fixtures/example-seed";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const data = buildFixtureData(exampleSeed());
const en = i18nCtx("en");
const fr = i18nCtx("fr");

function mount(source: AtlasDataSource, ui: ReactNode = <CommandCenter />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={source} queryClient={queryClient}>
      {ui}
    </AtlasProvider>,
  );
}

describe("CommandCenter", () => {
  const neutral = () => buildFixtureData(neutralSeed());

  it("shows a loading skeleton first, then the designed Home", async () => {
    const { container } = mount(createFixtureSource(neutral()));
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    for (const name of [
      /Projects in progress/,
      /Today/,
      /This week/,
      /Upcoming deadlines/,
      /Work history/,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
  });

  it("offers the quick actions and the key figures", async () => {
    mount(createFixtureSource(neutral()));
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    for (const name of [/New project/, /New task/, /Quick note/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText("Active projects")).toBeTruthy();
    expect(screen.getByText("Tasks to do")).toBeTruthy();
  });

  it("draws one card per project, each leading to its page", async () => {
    mount(createFixtureSource(neutral()));
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    const link = screen.getAllByRole("link", { name: /Refonte du site web/ })[0] as HTMLElement;
    expect(link.getAttribute("href")).toContain("/objects/");
    expect(screen.getAllByRole("link", { name: /Lancement v2.1/ }).length).toBeGreaterThan(0);
  });

  it("lists today's tasks as real links with a box to tick", async () => {
    mount(createFixtureSource(neutral()));
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    const box = screen.getAllByRole("button", { name: /Finish the task/ })[0] as HTMLElement;
    expect(box).toBeTruthy();
    const section = box.closest("section") as HTMLElement;
    expect(within(section).getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("ticks a task done and records the advance", async () => {
    const source = createFixtureSource(neutral());
    mount(source);
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    const before = (await source.progress(30)).length;
    const box = screen.getAllByRole("button", { name: /Finish the task/ })[0] as HTMLElement;
    box.click();
    await waitFor(async () => expect((await source.progress(30)).length).toBe(before + 1));
  });

  it("explains an empty account with a derived checklist, not an empty grid", async () => {
    const empty: AtlasDataSource = {
      ...createFixtureSource(data),
      graph: async () => ({ nodes: [], edges: [] }),
      activity: async () => [],
      settings: async () => ({
        baseCurrency: null,
        activeScenario: "base",
        timelineStart: null,
        timelineEnd: null,
        fxRates: [],
      }),
    };
    mount(empty);
    await screen.findByText("Build your Atlas");
    // The way in is a button, not a description: one click starts the first project.
    expect(screen.getByRole("button", { name: "Create your first project" })).toBeTruthy();
    expect(screen.getAllByText("(to do)").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("heading", { name: /Capital/ })).toBeNull();
  });

  it("says why it cannot load, with a retry, and never shows internals", async () => {
    const down: AtlasDataSource = {
      ...createFixtureSource(data),
      graph: async () => {
        throw new DataSourceError(503, "unavailable", "The database is not configured.");
      },
    };
    mount(down);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Data is not connected");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = mount(createFixtureSource(neutral()));
    await screen.findByRole("heading", { name: "Hello.", level: 1 });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("activity wording", () => {
  it("humanizes snake and camel case", () => {
    expect(humanize("target_date")).toBe("target date");
    expect(humanize("budgetAmount")).toBe("budget amount");
  });

  it("describes an update by its changed fields, capping the list", () => {
    const line = describeActivity(
      {
        id: 1,
        action: "updated",
        at: "2026-09-21T09:00:00Z",
        objectId: "x",
        edgeId: null,
        object: { type: "task", title: "T" },
        diff: {
          status: { from: "active", to: "done" },
          due: { from: null, to: "2027-05-01" },
          effort: { from: 1, to: 2 },
        },
      },
      en,
    );
    expect(line.verb).toBe("Updated");
    expect(line.detail).toBe("status: active → done · due: none → 1 May 2027 · +1 more");
    // The same entry in French: verbs, field names, values and dates are all translated.
    const french = describeActivity(
      {
        id: 1,
        action: "updated",
        at: "2026-09-21T09:00:00Z",
        objectId: "x",
        edgeId: null,
        object: { type: "task", title: "T" },
        diff: {
          status: { from: "active", to: "done" },
          due: { from: null, to: "2027-05-01" },
        },
      },
      fr,
    );
    expect(french.verb).toBe("Modifié");
    expect(french.detail).toBe("statut: actif → terminé · échéance: aucun → 1 mai 2027");
  });

  it("describes creation, deletion and links plainly", () => {
    const base = {
      id: 1,
      at: "2026-09-21T09:00:00Z",
      objectId: null,
      edgeId: null,
      object: null,
      diff: {},
    };
    expect(describeActivity({ ...base, action: "created" }, en)).toEqual({
      verb: "Created",
      detail: null,
    });
    expect(describeActivity({ ...base, action: "deleted" }, en).verb).toBe("Deleted");
    expect(
      describeActivity({ ...base, action: "related", diff: { kind: "depends_on" } }, en),
    ).toEqual({
      verb: "Linked",
      detail: "depends on",
    });
    expect(
      describeActivity({ ...base, action: "related", diff: { kind: "depends_on" } }, fr),
    ).toEqual({
      verb: "Relié",
      detail: "dépend de",
    });
  });

  it("words relative days", () => {
    expect(en.f.relativeDay(0)).toBe("today");
    expect(en.f.relativeDay(14)).toBe("in 14 d");
    expect(en.f.relativeDay(-3)).toBe("3 d overdue");
    expect(en.f.relativeDay(null)).toBeNull();
    expect(fr.f.relativeDay(0)).toBe("aujourd’hui");
    expect(fr.f.relativeDay(14)).toBe("dans 14 j");
    expect(fr.f.relativeDay(-3)).toBe("3 j de retard");
  });
});
