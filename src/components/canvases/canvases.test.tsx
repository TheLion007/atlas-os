// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildTimeline } from "@/domain/timeline";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { axeViolations } from "../../../tests/support/a11y";
import { GanttBoard } from "./GanttBoard";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const id = seedId;

describe("GanttBoard", () => {
  const model = buildTimeline(data.nodes, data.edges, data.today);

  it("draws today, milestones, dependency hairlines and a slip ghost", () => {
    const { container } = render(<GanttBoard model={model} today={data.today} />);
    expect(container.querySelector('[data-part="today"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-part="slip-ghost"]').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("button", {
        name: /Milestone: Purchase the Marina 1BR, .*92 days later than baseline/,
      }),
    ).toBeTruthy();
    expect(container.querySelectorAll("g[fill='none'] path").length).toBe(
      model.dependencies.length,
    );
  });

  it("shows tasks only when zoomed to quarters, and never in a compact strip", () => {
    const tasks = () => screen.queryAllByRole("button", { name: /^Task:/ });
    const { rerender } = render(<GanttBoard model={model} today={data.today} zoom="year" />);
    expect(tasks()).toHaveLength(0);
    rerender(<GanttBoard model={model} today={data.today} zoom="quarter" />);
    expect(tasks().length).toBeGreaterThan(5);
    rerender(<GanttBoard model={model} today={data.today} zoom="quarter" compact />);
    expect(tasks()).toHaveLength(0);
  });

  it("names the year or quarter axis by zoom", () => {
    const { container, rerender } = render(
      <GanttBoard model={model} today={data.today} zoom="year" />,
    );
    expect(container.textContent).toContain("2029");
    expect(container.textContent).not.toContain("Q3");
    rerender(<GanttBoard model={model} today={data.today} zoom="quarter" />);
    expect(container.textContent).toContain("Q3");
  });

  it("reserves the accent for the today line", () => {
    const { container, rerender } = render(<GanttBoard model={model} today={data.today} />);
    expect(container.querySelector(".stroke-accent")).toBeNull();
    rerender(<GanttBoard model={model} today={data.today} accentToday />);
    expect(container.querySelector('[data-part="today"]')?.getAttribute("class")).toContain(
      "stroke-accent",
    );
  });

  it("marks only real problems (slipped or overdue) as critical, not a normal wait", () => {
    const { container } = render(<GanttBoard model={model} today={data.today} />);
    const critical = [...container.querySelectorAll("path.stroke-critical")];
    expect(critical).toHaveLength(2); // Purchase (+92 d) and Relocation (+75 d)
    expect(
      screen
        .getByRole("button", { name: /Savings target reached/ })
        .querySelector(".stroke-critical"),
    ).toBeNull();
  });

  it("selects an item by click and keyboard", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GanttBoard model={model} today={data.today} onSelect={onSelect} />);
    const item = screen.getByRole("button", { name: /Milestone: Relocation/ });
    await user.click(item);
    expect(onSelect).toHaveBeenCalledWith(id("m_reloc"));
    item.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("carries the same information as a text table", () => {
    render(<GanttBoard model={model} today={data.today} />);
    const table = screen.getByRole("table", { name: /Scheduled milestones and tasks by project/ });
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(10);
    expect(within(table).getAllByText(/\+92 days/).length).toBe(1);
  });

  it("says so when nothing is scheduled", () => {
    const { container } = render(
      <GanttBoard model={{ ...model, rows: [], dependencies: [] }} today={data.today} />,
    );
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("empty");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <GanttBoard
        model={model}
        today={data.today}
        zoom="quarter"
        onSelect={() => {}}
        accentToday
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
