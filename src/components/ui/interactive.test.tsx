// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioVariant } from "@/domain/enums";
import { axeViolations } from "../../../tests/support/a11y";
import { emptyRelations, relation, relationsWith } from "../../../tests/support/factories";
import { RelationList } from "./RelationList";
import { RiskMatrix, type MatrixRisk } from "./RiskMatrix";
import { ScenarioSwitch } from "./ScenarioSwitch";

const risks: MatrixRisk[] = [
  { id: "r1", title: "Supplier delay", probability: 5, impact: 5 },
  { id: "r2", title: "FX swing", probability: 5, impact: 5 },
  { id: "r3", title: "Permit rejected", probability: 3, impact: 4 },
  { id: "r4", title: "Minor snag", probability: 1, impact: 2 },
];

describe("RiskMatrix", () => {
  it("is a named table, 5 by 5", () => {
    render(<RiskMatrix risks={risks} />);
    const table = screen.getByRole("table", { name: /Risk matrix/ });
    expect(within(table).getAllByRole("row")).toHaveLength(6); // header + 5 probability rows
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
  });

  it("shows how many risks cluster in a cell, and their derived level", () => {
    render(<RiskMatrix risks={risks} onSelectCell={() => {}} />);
    const cell = screen.getByRole("button", {
      name: "Probability 5, impact 5: 2 risks, level critical",
    });
    expect(cell.textContent).toBe("2");
    expect(
      screen.getByRole("button", { name: /Probability 1, impact 2: 1 risk, level low/ }),
    ).toBeTruthy();
  });

  it("selects a cell and hands over the risks in it", async () => {
    const user = userEvent.setup();
    const onSelectCell = vi.fn();
    render(<RiskMatrix risks={risks} onSelectCell={onSelectCell} />);
    await user.click(screen.getByRole("button", { name: /Probability 5, impact 5/ }));
    expect(onSelectCell).toHaveBeenCalledTimes(1);
    const cell = onSelectCell.mock.calls[0]?.[0];
    expect(cell.probability).toBe(5);
    expect(cell.impact).toBe(5);
    expect(cell.risks.map((r: MatrixRisk) => r.id)).toEqual(["r1", "r2"]);
  });

  it("confines colour to the top-right quadrant", () => {
    const { container } = render(<RiskMatrix risks={[]} />);
    const tinted = [...container.querySelectorAll("td > div")].filter((d) =>
      /bg-critical/.test(d.className),
    );
    // probability >= 3 and impact >= 3: a 3x3 block, and nothing outside it
    expect(tinted).toHaveLength(9);
    const low = container.querySelector('[data-level="low"]');
    expect(low?.className).not.toContain("bg-critical");
  });

  it("makes empty cells inert and marks the selected one", () => {
    render(
      <RiskMatrix risks={risks} onSelectCell={() => {}} selected={{ probability: 3, impact: 4 }} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3); // only occupied cells are buttons
    expect(
      screen.getByRole("button", { name: /Probability 3, impact 4/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RiskMatrix risks={risks} onSelectCell={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

function Harness({ committed }: { committed: ScenarioVariant }) {
  const [value, setValue] = useState<ScenarioVariant>(committed);
  return (
    <ScenarioSwitch
      value={value}
      committed={committed}
      onChange={setValue}
      onReset={() => setValue(committed)}
    />
  );
}

describe("ScenarioSwitch", () => {
  it("offers the three variants as one radio group", () => {
    render(<Harness committed="base" />);
    const group = screen.getByRole("group", { name: "Scenario" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(["conservative", "base", "optimistic"]);
    expect((screen.getByRole("radio", { name: "Base" }) as HTMLInputElement).checked).toBe(true);
  });

  it("is clean at the committed scenario and flags a preview otherwise", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness committed="base" />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("clean");
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Conservative" }));
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("dirty");
    expect(screen.getByRole("status").textContent).toContain("Preview");
  });

  it("returns to the committed scenario", async () => {
    const user = userEvent.setup();
    render(<Harness committed="base" />);
    await user.click(screen.getByRole("radio", { name: "Optimistic" }));
    await user.click(screen.getByRole("button", { name: "Back to Base" }));
    expect((screen.getByRole("radio", { name: "Base" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("works from the keyboard with arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness committed="base" />);
    screen.getByRole("radio", { name: "Base" }).focus();
    await user.keyboard("{ArrowRight}");
    expect((screen.getByRole("radio", { name: "Optimistic" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("can be disabled", () => {
    render(<ScenarioSwitch value="base" onChange={() => {}} disabled />);
    expect((screen.getByRole("radio", { name: "Base" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Harness committed="base" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("RelationList", () => {
  it("groups by verb and spells out the direction", () => {
    const groups = emptyRelations();
    groups.depends_on.outgoing = [relation("estimate", "Savings rate", { lagDays: 30 })];
    groups.depends_on.incoming = [relation("milestone", "Relocation")];
    groups.located_at.outgoing = [relation("location", "Dorsel Marina")];
    render(<RelationList groups={groups} />);
    const dependsOn = screen.getByRole("group", { name: "Depends on" });
    expect(within(dependsOn).getByText("Depends on")).toBeTruthy();
    expect(within(dependsOn).getByText("Required by")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Located at" })).toBeTruthy();
  });

  it("omits verbs with nothing in them, and never shows a flat 'linked items' list", () => {
    render(
      <RelationList
        groups={relationsWith("references", "incoming", [relation("note", "Research")])}
      />,
    );
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getByText("Referenced by")).toBeTruthy();
    expect(screen.queryByText(/linked items/i)).toBeNull();
  });

  it("shows lag on a dependency and the label on a reference", () => {
    const groups = emptyRelations();
    groups.depends_on.outgoing = [
      relation("milestone", "Purchase", { lagDays: -14, dependencyType: "ss" }),
    ];
    groups.references.outgoing = [relation("person", "Agent", { label: "assignee" })];
    render(<RelationList groups={groups} />);
    expect(screen.getByRole("button", { name: /Purchase/ }).textContent).toContain("−14 d · ss");
    expect(screen.getByRole("button", { name: /Agent/ }).textContent).toContain("assignee");
  });

  it("says so when there are no relations", () => {
    const { container } = render(<RelationList groups={emptyRelations()} />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("empty");
    expect(container.textContent).toContain("No relations yet");
  });

  it("peeks a related object", async () => {
    const user = userEvent.setup();
    const onPeek = vi.fn();
    const item = relation("task", "Book viewing");
    render(<RelationList groups={relationsWith("contains", "outgoing", [item])} onPeek={onPeek} />);
    await user.click(screen.getByRole("button", { name: /Book viewing/ }));
    expect(onPeek).toHaveBeenCalledWith(item.object.id);
  });

  it("offers add controls only when it can add, and shows the add slot in add-mode", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const groups = relationsWith("contains", "outgoing", [relation("task", "T")]);
    const { rerender, container } = render(<RelationList groups={groups} />);
    expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();

    rerender(<RelationList groups={groups} onAdd={onAdd} addSlot={<p>Pick an object</p>} />);
    await user.click(screen.getByRole("button", { name: /Add contains/i }));
    expect(onAdd).toHaveBeenCalledWith("contains");
    expect(screen.getByText("Pick an object")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("add-mode");
  });

  it("has no accessibility violations", async () => {
    const groups = emptyRelations();
    groups.contains.outgoing = [relation("task", "Book viewing")];
    groups.depends_on.incoming = [relation("milestone", "Relocation", { lagDays: 30 })];
    const { container } = render(
      <RelationList
        groups={groups}
        onPeek={() => {}}
        hrefFor={(id) => `/objects/${id}`}
        onAdd={() => {}}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
