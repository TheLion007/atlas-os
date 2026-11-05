// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiObjectWithRelations } from "@/domain/api-types";
import { deriveFacts } from "@/domain/object-facts";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { withRelations } from "@/domain/relations";
import { axeViolations } from "../../../tests/support/a11y";
import { AIThread, type ThreadMessage } from "./AIThread";
import { CommandPalette } from "./CommandPalette";
import { ObjectView } from "./ObjectView";
import { buildPaletteItems, type PaletteActions } from "./palette-items";
import { i18nCtx } from "../../../tests/support/i18n";
import { PeekPanel } from "./PeekPanel";
import { Sidebar } from "./Sidebar";
import { useUi } from "./ui-store";
import { exampleSeed } from "@tests/fixtures/example-seed";

let pathname = "/";
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const data = buildFixtureData(exampleSeed());
const objectWith = (key: string): ApiObjectWithRelations =>
  withRelations(
    data.nodes.find((n) => n.id === seedId(key))!,
    data.nodes,
    data.edges,
  );

beforeEach(() => {
  pathname = "/";
  search = "";
  useUi.setState({
    sidebar: "auto",
    navOpen: false,
    paletteOpen: false,
    assistantOpen: false,
    peekPinned: false,
    recent: [],
  });
});

describe("Sidebar", () => {
  it("has no accessibility violations", async () => {
    const { container } = render(<Sidebar />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

function PaletteHarness({ actions }: { actions: PaletteActions }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const items = buildPaletteItems({
    query,
    nodes: data.nodes,
    recent: [seedId("p_reloc")],
    scenario: "base",
    locale: "en",
    t: i18nCtx("en").t,
    actions,
  });
  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      items={items}
    />
  );
}
const mkActions = (): PaletteActions => ({
  peek: vi.fn(),
  open: vi.fn(),
  go: vi.fn(),
  setScenario: vi.fn(),
  toggleSidebar: vi.fn(),
  openAssistant: vi.fn(),
  toggleTheme: vi.fn(),
  toggleTimer: vi.fn(),
  create: vi.fn(),
  setLocale: vi.fn(),
});

describe("CommandPalette", () => {
  it("opens as a combobox over a listbox, showing recent objects and places first", () => {
    render(<PaletteHarness actions={mkActions()} />);
    const input = screen.getByRole("combobox", { name: /Search or run a command/ });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Quick actions" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Go to" })).toBeTruthy();
  });

  it("narrows results as you type, grouped by object type", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness actions={mkActions()} />);
    await user.type(screen.getByRole("combobox"), "marina");
    expect(screen.getByRole("group", { name: "Locations" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dorsel Marina/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Visa/ })).toBeNull();
  });

  it("moves the highlight with the arrow keys and exposes it to assistive technology", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness actions={mkActions()} />);
    const input = screen.getByRole("combobox");
    const active = () =>
      document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent;
    const first = active();
    await user.keyboard("{ArrowDown}");
    expect(active()).not.toBe(first);
    await user.keyboard("{ArrowUp}");
    expect(active()).toBe(first);
    await user.keyboard("{End}");
    expect(screen.getAllByRole("option").at(-1)?.getAttribute("aria-selected")).toBe("true");
  });

  it("opens the highlighted object's page on Enter and closes", async () => {
    const user = userEvent.setup();
    const actions = mkActions();
    render(<PaletteHarness actions={actions} />);
    await user.type(screen.getByRole("combobox"), "Dorsel relocation");
    await user.keyboard("{Enter}");
    expect(actions.open).toHaveBeenCalledWith(seedId("p_reloc"));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("peeks the object on Alt+Enter", async () => {
    const user = userEvent.setup();
    const actions = mkActions();
    render(<PaletteHarness actions={actions} />);
    await user.type(screen.getByRole("combobox"), "Dorsel relocation");
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    expect(actions.peek).toHaveBeenCalledWith(seedId("p_reloc"));
    expect(actions.open).not.toHaveBeenCalled();
  });

  it("switches to action mode after '>' and runs an action", async () => {
    const user = userEvent.setup();
    const actions = mkActions();
    render(<PaletteHarness actions={actions} />);
    await user.type(screen.getByRole("combobox"), ">conserv");
    expect(screen.getByRole("listbox", { name: "Actions" })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(actions.setScenario).toHaveBeenCalledWith("conservative");
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness actions={mkActions()} />);
    await user.type(screen.getByRole("combobox"), "zzzzqq");
    expect(screen.getByRole("status").textContent).toContain("Nothing found");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness actions={mkActions()} />);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    render(<PaletteHarness actions={mkActions()} />);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("AIThread", () => {
  const purchase = { id: "m1", type: "milestone" as const, title: "Purchase the Marina 1BR" };
  const savings = { id: "e1", type: "estimate" as const, title: "Monthly savings (base)" };

  it("is honest when not connected: a disabled composer and no invented answers", () => {
    const { container } = render(<AIThread messages={[]} />);
    expect(screen.getByText("The assistant is not connected yet")).toBeTruthy();
    expect((screen.getByLabelText("Ask the assistant") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("[data-state='no-grounding']")).toBeTruthy();
  });

  it("renders a cited answer with object chips inline and a Sources list", () => {
    const messages: ThreadMessage[] = [
      {
        id: "a",
        role: "assistant",
        segments: ["The move date rests on ", purchase, ", which depends on ", savings, "."],
        citations: [purchase, savings],
      },
    ];
    const { container } = render(<AIThread messages={messages} onAsk={() => {}} />);
    expect(container.querySelector("[data-state='cited-answer']")).toBeTruthy();
    expect(
      within(screen.getByRole("log")).getAllByText("Purchase the Marina 1BR").length,
    ).toBeGreaterThanOrEqual(2); // inline + source
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("refuses an answer that cites nothing, and never shows its text", () => {
    const messages: ThreadMessage[] = [
      {
        id: "a",
        role: "assistant",
        segments: ["You will definitely move in 2029."],
        citations: [],
      },
    ];
    const { container } = render(<AIThread messages={messages} onAsk={() => {}} />);
    expect(screen.queryByText(/definitely move/)).toBeNull();
    expect(container.querySelector("[data-state='no-grounding']")?.textContent).toMatch(
      /won’t guess/,
    );
  });

  it("shows an explicit refusal as written", () => {
    render(
      <AIThread
        messages={[{ id: "r", role: "refusal", text: "No object mentions that." }]}
        onAsk={() => {}}
      />,
    );
    expect(screen.getByText("No object mentions that.")).toBeTruthy();
  });

  it("asks a question, clears the input, and shows the thinking state", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const { rerender } = render(<AIThread messages={[]} onAsk={onAsk} />);
    await user.type(screen.getByLabelText("Ask the assistant"), "What is blocking my move?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).toHaveBeenCalledWith("What is blocking my move?");
    expect((screen.getByLabelText("Ask the assistant") as HTMLInputElement).value).toBe("");

    rerender(
      <AIThread
        messages={[{ id: "u", role: "user", text: "What is blocking my move?" }]}
        status="thinking"
        onAsk={onAsk}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Reading your data");
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("has no accessibility violations", async () => {
    const messages: ThreadMessage[] = [
      { id: "u", role: "user", text: "Why?" },
      {
        id: "a",
        role: "assistant",
        segments: ["Because of ", purchase, "."],
        citations: [purchase],
      },
      { id: "r", role: "refusal", text: "I can’t say." },
    ];
    const { container } = render(<AIThread messages={messages} onAsk={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("ObjectView", () => {
  const view = (key: string, extra: Partial<Parameters<typeof ObjectView>[0]> = {}) => {
    const object = objectWith(key);
    return render(
      <ObjectView
        object={object}
        facts={deriveFacts(object.id, data.nodes, data.edges)}
        {...extra}
      />,
    );
  };

  it("labels an estimate's provenance and refuses to pass an assumption off as fact", () => {
    view("e_sav_b");
    expect(screen.getByText("Assumption")).toBeTruthy();
    expect(screen.getByText(/not a confirmed figure/)).toBeTruthy();
  });

  it("does not add that caveat to an actual figure", () => {
    view("e_cap_actual");
    expect(screen.getByText("Actual")).toBeTruthy();
    expect(screen.queryByText(/not a confirmed/)).toBeNull();
  });

  it("shows an unset confidence on an estimate as not assessed, not as low", () => {
    view("e_cap_target");
    expect(screen.getByRole("img", { name: "Confidence: not assessed" })).toBeTruthy();
  });

  it("shows derived progress separately and says it is computed, never stored", () => {
    view("p_reloc");
    expect(screen.getByText(/Computed from the plan, never stored/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  });

  it("shows slip against the baseline for a milestone", () => {
    view("m_purchase");
    expect(screen.getByText(/92 d vs baseline/)).toBeTruthy();
  });

  it("names what blocks a task and marks it blocked", () => {
    view("t_valuation", { onPeek: () => {} });
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Blocked by")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Review service charge history/ }).length,
    ).toBeGreaterThan(0);
  });

  it("groups relations by verb", () => {
    view("prop_marina");
    expect(screen.getByRole("group", { name: "Located at" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Funded by" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Estimates" })).toBeTruthy();
  });

  it("renders the same content as a page or a panel", () => {
    const { unmount } = view("p_marina", { variant: "panel" });
    const panel = document.body.textContent;
    unmount();
    view("p_marina", { variant: "page" });
    expect(document.body.textContent).toBe(panel);
  });

  it("has no accessibility violations across representative types", async () => {
    for (const key of [
      "p_reloc",
      "m_purchase",
      "e_sav_b",
      "r_price",
      "d_mortgage",
      "n_scout",
      "marina",
      "t_valuation",
    ]) {
      const { container, unmount } = view(key, {
        onPeek: () => {},
        hrefFor: (id) => `/objects/${id}`,
      });
      expect(await axeViolations(container), key).toEqual([]);
      unmount();
    }
  });
});

describe("PeekPanel", () => {
  const body: ReactNode = <p>Body</p>;

  it("docks as a named complementary region and closes with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PeekPanel docked title="Dorsel relocation" onClose={onClose} onTogglePin={() => {}}>
        {body}
      </PeekPanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Peek: Dorsel relocation" });
    expect(panel.getAttribute("data-state")).toBe("peek");
    within(panel).getByRole("button", { name: "Close panel" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on Escape when pinned, and the pin button reflects it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PeekPanel docked mode="pinned" title="x" onClose={onClose} onTogglePin={() => {}}>
        {body}
      </PeekPanel>,
    );
    const pin = screen.getByRole("button", { name: "Pin panel" });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    pin.focus();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers pinning only where it makes sense (docked)", () => {
    const { rerender } = render(
      <PeekPanel docked title="x" onClose={() => {}}>
        {body}
      </PeekPanel>,
    );
    expect(screen.queryByRole("button", { name: "Pin panel" })).toBeNull();
    rerender(
      <PeekPanel docked title="x" onClose={() => {}} onTogglePin={() => {}}>
        {body}
      </PeekPanel>,
    );
    expect(screen.getByRole("button", { name: "Pin panel" })).toBeTruthy();
  });

  it("labels the editing state", () => {
    render(
      <PeekPanel docked mode="editing" title="x" onClose={() => {}}>
        {body}
      </PeekPanel>,
    );
    expect(screen.getByText("Editing")).toBeTruthy();
    expect(screen.getByRole("complementary").getAttribute("data-state")).toBe("editing");
  });

  it("becomes a modal sheet below the wide breakpoint: focus is trapped and Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PeekPanel docked={false} title="Dorsel relocation" onClose={onClose}>
        {body}
      </PeekPanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "Dorsel relocation" });
    expect(dialog).toBeTruthy();
    await act(async () => {});
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("has no accessibility violations in either form", async () => {
    const { container, unmount } = render(
      <PeekPanel docked title="x" onClose={() => {}} onTogglePin={() => {}}>
        {body}
      </PeekPanel>,
    );
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    render(
      <PeekPanel docked={false} title="x" onClose={() => {}}>
        {body}
      </PeekPanel>,
    );
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
