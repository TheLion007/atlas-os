// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData } from "@/seed/fixtures";
import { useUi } from "../shell/ui-store";
import { MemoryLens } from "./MemoryLens";
import { exampleSeed } from "@tests/fixtures/example-seed";

vi.mock("next/navigation", () => ({
  usePathname: () => "/memory",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const data = buildFixtureData(exampleSeed());

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={createFixtureSource(data)} queryClient={queryClient}>
      <MemoryLens />
    </AtlasProvider>,
  );
}

beforeEach(() => {
  useUi.setState({
    sidebar: "auto",
    navOpen: false,
    paletteOpen: false,
    assistantOpen: false,
    peekPinned: false,
    recent: [],
  });
});

describe("MemoryLens", () => {
  it("lists every memory from the shared graph, not a second store", async () => {
    mount();
    expect(await screen.findByText("Prefer cash purchase")).toBeTruthy();
    expect(screen.getByText("Purchase property before relocation")).toBeTruthy();
    expect(screen.getByText("3 memories")).toBeTruthy();
  });

  it("shows each memory's inherited project context, not a duplicated colour", async () => {
    mount();
    await screen.findByText("Prefer cash purchase");
    // "Purchase property before relocation" is about Dorsel relocation (its primary context).
    expect(screen.getAllByText(/Dorsel relocation/).length).toBeGreaterThan(0);
  });

  it("filters by a free-text query across title and detail", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Prefer cash purchase");
    await user.type(screen.getByPlaceholderText("Search memories…"), "cash");
    await waitFor(() => {
      expect(screen.queryByText("Purchase property before relocation")).toBeNull();
    });
    expect(screen.getByText("Prefer cash purchase")).toBeTruthy();
  });

  it("filters by project, narrowing to memories about it", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Prefer cash purchase");
    const marina = data.nodes.find((n) => n.title === "Marina 1BR purchase")!;
    await user.selectOptions(screen.getByLabelText("Project"), marina.id);
    await waitFor(() => {
      expect(screen.queryByText("Purchase property before relocation")).toBeNull();
    });
    expect(screen.getByText("Prefer cash purchase")).toBeTruthy();
  });

  it("filters by memory type", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Prefer cash purchase");
    await user.selectOptions(screen.getByLabelText("Type"), "plan");
    await waitFor(() => {
      expect(screen.queryByText("Prefer cash purchase")).toBeNull();
    });
    expect(screen.getByText("Purchase property before relocation")).toBeTruthy();
  });

  it("switches to Grid view without losing any memory", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Prefer cash purchase");
    await user.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getByText("Prefer cash purchase")).toBeTruthy();
    expect(screen.getByText("Purchase property before relocation")).toBeTruthy();
  });

  it("switches to Graph view, rendering the same memories as graph nodes", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Prefer cash purchase");
    await user.click(screen.getByRole("button", { name: "Graph" }));
    // GraphCanvas exposes the same objects as an accessible list for keyboard/screen-reader use.
    expect(await screen.findByRole("button", { name: /Prefer cash purchase/ })).toBeTruthy();
  });

  it("offers a 'New memory' action wired to the shared create dialog", async () => {
    mount();
    await screen.findByText("Prefer cash purchase");
    const button = screen.getByRole("button", { name: /New memory/ });
    button.click();
    expect(useUi.getState().create).toEqual({ type: "memory" });
  });
});
