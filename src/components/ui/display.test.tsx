// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../tests/support/a11y";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { MetricTile } from "./MetricTile";
import { ProgressRail } from "./ProgressRail";
import { StatusBadge } from "./StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "./states";

describe("StatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["active", "Active"],
    ["done", "Done"],
    ["dropped", "Dropped"],
  ] as const)("shows %s as text", (status, text) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("shows derived 'blocked' for a live object, but never for a finished one", () => {
    const { rerender } = render(<StatusBadge status="active" blocked />);
    expect(screen.getByText("Blocked")).toBeTruthy();
    rerender(<StatusBadge status="draft" blocked />);
    expect(screen.getByText("Blocked")).toBeTruthy();
    rerender(<StatusBadge status="done" blocked />);
    expect(screen.getByText("Done")).toBeTruthy();
    rerender(<StatusBadge status="dropped" blocked />);
    expect(screen.getByText("Dropped")).toBeTruthy();
  });
});

describe("ConfidenceMeter", () => {
  const label = (c: HTMLElement) => c.querySelector('[role="img"]')?.getAttribute("aria-label");

  it.each([
    [90, "high", 5],
    [75, "high", 4],
    [60, "medium", 3],
    [45, "medium", 3],
    [40, "low", 2],
    [10, "low", 1],
  ] as const)("score %i is %s with %i ticks", (score, band, ticks) => {
    const { container } = render(<ConfidenceMeter score={score} />);
    expect(container.firstElementChild?.getAttribute("data-band")).toBe(band);
    expect(label(container)).toBe(`Confidence: ${band}, ${score} of 100`);
    expect(container.querySelectorAll(".bg-fg").length).toBe(ticks);
  });

  it("draws an unassessed value hollow, so unknown never looks like low", () => {
    const { container } = render(<ConfidenceMeter score={null} showLabel />);
    expect(container.firstElementChild?.getAttribute("data-band")).toBe("unset");
    expect(label(container)).toBe("Confidence: not assessed");
    expect(container.querySelectorAll(".bg-fg").length).toBe(0);
    expect(container.textContent).toContain("Not assessed");
  });

  it("is always five ticks, not a percentage bar", () => {
    const { container } = render(<ConfidenceMeter score={50} />);
    expect(container.querySelectorAll('[role="img"] > span').length).toBe(5);
  });
});

describe("ProgressRail", () => {
  it("exposes progress as a progressbar with a readable value", () => {
    render(<ProgressRail label="Marina 1BR" actual={0.26} />);
    const bar = screen.getByRole("progressbar", { name: "Marina 1BR" });
    expect(bar.getAttribute("aria-valuenow")).toBe("26");
    expect(bar.getAttribute("aria-valuetext")).toBe("26% of plan");
  });

  it("reports no data as no data, never 0%", () => {
    const { container } = render(<ProgressRail label="Renovation" actual={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("img", { name: "Renovation: no data" })).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("no-data");
  });

  it("draws a real zero as a zero-width fill, distinct from no data", () => {
    const { container } = render(<ProgressRail label="Not started" actual={0} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(container.querySelector('[data-part="actual"]')?.getAttribute("width")).toBe("0%");
  });

  it("hatches the projection and marks the target", () => {
    const { container } = render(<ProgressRail label="Capital" actual={0.3} projected={0.8} />);
    expect(container.querySelector('[data-part="projected"]')).toBeTruthy();
    expect(container.querySelector('[data-part="target"]')).toBeTruthy();
  });

  it("shows an overrun beyond the target instead of clipping it", () => {
    const { container } = render(<ProgressRail label="Budget" actual={1.25} />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("overrun");
    expect(container.querySelector('[data-part="overrun"]')).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toContain("over plan");
  });

  it("keeps sand for the one focal rail", () => {
    const { container, rerender } = render(<ProgressRail label="x" actual={0.5} />);
    expect(container.querySelector(".fill-accent")).toBeNull();
    rerender(<ProgressRail label="x" actual={0.5} accent />);
    expect(container.querySelector('[data-part="actual"]')?.getAttribute("class")).toContain(
      "fill-accent",
    );
  });
});

describe("MetricTile", () => {
  it("shows label, value, suffix and delta", () => {
    render(
      <MetricTile
        label="Capital"
        value="€109,400"
        suffix="of €420,000"
        delta={{ value: 2400, label: "this month", good: "up" }}
      />,
    );
    expect(screen.getByText("Capital")).toBeTruthy();
    expect(screen.getByText("€109,400")).toBeTruthy();
    expect(screen.getByText("of €420,000")).toBeTruthy();
    expect(screen.getByText("+2,400")).toBeTruthy();
  });

  it("colours a delta only when a direction is favourable, and by whether it helped", () => {
    const dot = (c: HTMLElement) => c.querySelector('p > span[aria-hidden="true"]');
    const { container, rerender } = render(
      <MetricTile label="x" value="1" delta={{ value: 5, good: "up" }} />,
    );
    expect(dot(container)?.className).toContain("bg-positive");
    rerender(<MetricTile label="x" value="1" delta={{ value: -5, good: "up" }} />);
    expect(dot(container)?.className).toContain("bg-critical");
    rerender(<MetricTile label="x" value="1" delta={{ value: 5, good: "down" }} />);
    expect(dot(container)?.className).toContain("bg-critical");
    rerender(<MetricTile label="x" value="1" delta={{ value: 5 }} />);
    expect(dot(container)?.className).toContain("bg-fg-muted");
  });

  it("renders the loading state as busy, without inventing a number", () => {
    const { container } = render(
      <MetricTile label="Capital" state="loading" value="SHOULD NOT SHOW" />,
    );
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain("SHOULD NOT SHOW");
  });

  it("renders no-data with the reason", () => {
    render(
      <MetricTile label="Purchase date" state="no-data" noDataNote="Needs a scenario model" />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Needs a scenario model")).toBeTruthy();
  });

  it("links into its object when given an href", () => {
    render(<MetricTile label="Risks" value="4" href="/risks" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/risks");
  });

  it("draws a sparkline that ends on the latest value", () => {
    const { container } = render(<MetricTile label="x" value="1" sparkline={[1, 3, 2, 5]} />);
    expect(container.querySelector("polyline")).toBeTruthy();
    expect(container.querySelector("circle")).toBeTruthy();
  });
});

describe("EmptyState / LoadingState / ErrorState", () => {
  it("renders an empty checklist with derived done-ness, in text as well as marks", () => {
    render(
      <EmptyState
        title="Nothing here yet"
        checklist={[
          { label: "Choose a base currency", done: true },
          { label: "Create a project", done: false },
        ]}
      />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("(done)");
    expect(items[1]?.textContent).toContain("(to do)");
  });

  it("announces loading politely", () => {
    render(<LoadingState label="Loading projects" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading projects");
    expect(status.getAttribute("aria-busy")).toBe("true");
  });

  it("announces errors and offers a retry only when it can", () => {
    const { rerender } = render(<ErrorState message="The database is not configured." />);
    expect(screen.getByRole("alert").textContent).toContain("The database is not configured.");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ErrorState message="x" onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <StatusBadge status="active" blocked />
        <ConfidenceMeter score={62} showLabel />
        <ProgressRail label="Capital" actual={0.26} projected={0.7} accent />
        <ProgressRail label="Empty" actual={null} />
        <MetricTile label="Capital" value="€109,400" delta={{ value: 3 }} sparkline={[1, 2, 3]} />
        <MetricTile label="Loading" state="loading" />
        <MetricTile label="None" state="no-data" />
        <EmptyState title="Empty" checklist={[{ label: "Do a thing", done: false }]} />
        <LoadingState />
        <ErrorState message="Nope" onRetry={() => {}} />
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
