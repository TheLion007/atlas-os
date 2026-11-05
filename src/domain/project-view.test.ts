import { describe, expect, it } from "vitest";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { neutralSeed } from "@/seed/neutral-fr";
import {
  descendantsOf,
  projectBoard,
  projectCards,
  recentDays,
  streak,
  type BoardColumn,
} from "./project-view";
import type { ProgressEntry } from "./api-types";

const d = buildFixtureData(neutralSeed());

const entry = (day: string, projectId: string | null = null, id = 1): ProgressEntry => ({
  id,
  at: `${day}T09:00:00Z`,
  day,
  projectId,
  objectId: null,
  kind: "task_done",
});

describe("project cards", () => {
  const cards = projectCards(d.nodes, d.edges, d.today);

  it("has one card per project, most urgent first", () => {
    expect(cards).toHaveLength(5);
    expect(cards[0]?.title).toBe("Refonte du site web");
    const days = cards.map((c) => c.daysLeft ?? 9999);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it("rolls progress up from the tasks and counts what is late", () => {
    const web = cards.find((c) => c.id === seedId("p_web"));
    expect(web?.progress).toBeGreaterThan(0);
    expect(web?.progress).toBeLessThan(1);
    expect(web?.tasksDone).toBe(3);
    expect(web?.tasksLate).toBe(2);
    expect(web?.subProjects.map((s) => s.title)).toContain("Pages produit");
  });
});

describe("the project board", () => {
  const board = projectBoard(seedId("p_web"), d.nodes, d.edges, d.today);

  it("spreads the tasks over the three lifecycle columns", () => {
    const counts = (["draft", "active", "done"] as BoardColumn[]).map((c) => board[c].length);
    expect(counts).toEqual([2, 5, 3]);
  });

  it("flags late tasks and names the sub-project they sit in", () => {
    const audit = board.active.find((c) => c.title.startsWith("Audit de contraste"));
    expect(audit?.late).toBe(true);
    expect(audit?.group).toBe("Accessibilité");
    expect(board.done.every((c) => !c.late)).toBe(true);
  });

  it("includes everything below a project, and nothing else", () => {
    const inside = descendantsOf(seedId("p_web"), d.edges);
    expect(inside.has(seedId("t_web1"))).toBe(true);
    expect(inside.has(seedId("t_v1"))).toBe(false);
  });
});

describe("recent days and streaks", () => {
  const today = "2026-10-31";
  const log = [
    entry("2026-10-31", "a", 1),
    entry("2026-10-31", "b", 2),
    entry("2026-10-30", "a", 3),
    entry("2026-10-28", "a", 4),
  ];

  it("counts progress per day, ending today, optionally for one project", () => {
    const bars = recentDays(log, today, 7);
    expect(bars).toHaveLength(7);
    expect(bars.at(-1)).toMatchObject({ day: today, count: 2, isToday: true });
    expect(bars.at(-2)?.count).toBe(1);
    expect(recentDays(log, today, 7, "b").at(-1)?.count).toBe(1);
  });

  it("counts the days in a row, and forgives a day not over yet", () => {
    expect(streak(log, today)).toBe(2);
    expect(streak(log.slice(2), today)).toBe(1); // nothing yet today: yesterday still counts
    expect(streak([entry("2026-10-20")], today)).toBe(0);
  });
});
