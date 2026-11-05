// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { axeViolations } from "../../../tests/support/a11y";
import { GraphCanvas, type GraphHandle } from "./GraphCanvas";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());

describe("GraphCanvas (the React shell around the engine)", () => {
  it("names the graph for assistive technology, in the interface language", () => {
    const { rerender } = render(<GraphCanvas nodes={data.nodes} edges={data.edges} />);
    expect(
      screen.getByRole("group", {
        name: `Relationship graph: ${data.nodes.length} objects, ${data.edges.length} relations`,
      }),
    ).toBeTruthy();
    rerender(
      <I18nProvider initial="fr">
        <GraphCanvas nodes={data.nodes} edges={data.edges} />
      </I18nProvider>,
    );
    expect(screen.getByRole("group", { name: /^Graphe des relations : \d+ objets/ })).toBeTruthy();
  });

  it("offers every object as a keyboard-reachable button, since the canvas is only a picture", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<GraphCanvas nodes={data.nodes} edges={data.edges} onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "Project: Dorsel relocation" });
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(seedId("p_reloc"));
  });

  it("marks the selected object as pressed, and clears on a second press", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <GraphCanvas
        nodes={data.nodes}
        edges={data.edges}
        selectedId={seedId("p_reloc")}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", { name: "Project: Dorsel relocation" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("drops hidden types from the graph and its text alternative", () => {
    render(<GraphCanvas nodes={data.nodes} edges={data.edges} hiddenTypes={new Set(["task"])} />);
    expect(screen.queryByRole("button", { name: /^Task:/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Project:/ }).length).toBeGreaterThan(0);
    const tasks = data.nodes.filter((n) => n.type === "task").length;
    expect(
      screen.getByRole("group", { name: new RegExp(`${data.nodes.length - tasks} objects`) }),
    ).toBeTruthy();
  });

  it("clears the selection on Escape and hands the camera to the controls through its handle", async () => {
    const onSelect = vi.fn();
    const handle = createRef<GraphHandle>();
    const user = userEvent.setup();
    render(
      <GraphCanvas
        nodes={data.nodes}
        edges={data.edges}
        selectedId={seedId("p_reloc")}
        onSelect={onSelect}
        handleRef={handle}
      />,
    );
    expect(Object.keys(handle.current ?? {}).sort()).toEqual(["fit", "focusOn", "reset", "zoomBy"]);
    screen.getByRole("button", { name: "Project: Dorsel relocation" }).focus();
    await user.keyboard("{Escape}");
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("works with nothing in it", () => {
    render(<GraphCanvas nodes={[]} edges={[]} />);
    expect(screen.getByRole("group", { name: /0 objects, 0 relations/ })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<GraphCanvas nodes={data.nodes} edges={data.edges} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
