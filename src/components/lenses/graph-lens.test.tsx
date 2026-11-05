// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { neutralSeed } from "@/seed/neutral-fr";
import { GraphLens } from "./GraphLens";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/graph",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

// The canvas is drawn with a 2D context jsdom does not have; the panel is what is under test, so
// the canvas is replaced by one button per node that selects it, as a click on the node would.
vi.mock("../canvases/GraphCanvas", () => ({
  GraphCanvas: (props: {
    nodes: { id: string; title: string }[];
    onSelect: (id: string | null) => void;
    onOpen: (id: string) => void;
  }) => (
    <div>
      {props.nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-node={n.title}
          onClick={() => props.onSelect(n.id)}
          onDoubleClick={() => props.onOpen(n.id)}
        >
          node {n.title}
        </button>
      ))}
    </div>
  ),
}));

// A wide screen, so the whole network is shown (not just a node and its neighbours).
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as never;

const data = buildFixtureData(neutralSeed());

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={createFixtureSource(data)} queryClient={queryClient}>
      <GraphLens />
    </AtlasProvider>,
  );
}

describe("the Graph's node card", () => {
  it("shows nothing until a node is clicked, and never the old preview panel", async () => {
    mount();
    await screen.findByRole("heading", { name: "Graph", level: 2 });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText(/Drag the background to move/)).toBeTruthy();
  });

  it("shows the kind, name, project, progress, connections and an Open button", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "node Lancement v2.1" }));
    const card = screen.getByRole("complementary");
    expect(within(card).getByRole("heading", { name: "Lancement v2.1" })).toBeTruthy();
    expect(within(card).getByText("Project")).toBeTruthy();
    expect(within(card).getByText(/^\d+ %$/)).toBeTruthy();
    expect(within(card).getByText(/connections/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("names each connection by its relation and moves to the other node on a click", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "node Lancement v2.1" }));
    let card = screen.getByRole("complementary");
    expect(within(card).getByText("part of")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: /Feuille de route 2026/ }));
    card = screen.getByRole("complementary");
    expect(within(card).getByRole("heading", { name: "Feuille de route 2026" })).toBeTruthy();
  });

  it("opens the real page with Open and with a double-click on a node", async () => {
    push.mockClear();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "node Lancement v2.1" }));
    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", { name: "Open" }),
    );
    expect(push).toHaveBeenLastCalledWith(`/objects/${seedId("p_v21")}`);
    fireEvent.doubleClick(screen.getByRole("button", { name: "node Export PDF" }));
    expect(push).toHaveBeenLastCalledWith(`/objects/${seedId("s_v21_b")}`);
  });

  it("hides and shows a kind of object from its pill", async () => {
    mount();
    const pill = await screen.findByRole("button", { name: /^Tasks/ });
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });
});
