// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData, emptyFixtureData, type FixtureData } from "@/seed/fixtures";
import { useUi } from "../shell/ui-store";
import { DocumentsLens } from "./DocumentsLens";
import { FinanceLens } from "./FinanceLens";
import { exampleSeed } from "@tests/fixtures/example-seed";

vi.mock("next/navigation", () => ({
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function mount(ui: React.ReactNode, data: FixtureData = buildFixtureData(exampleSeed())) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={createFixtureSource(data)} queryClient={queryClient}>
      {ui}
    </AtlasProvider>,
  );
}

beforeEach(() => {
  useUi.setState({ create: null, edit: null, recent: [], peekPinned: false });
});

describe("FinanceLens", () => {
  it("shows the actual picture, computed from the objects (never hard-coded)", async () => {
    mount(<FinanceLens />);
    await screen.findByText("Where you stand");
    // Seed actuals: cash 109 400 + 6 200; investments 42 800 + 8 500 USD (no USD rate: left out);
    // flat 310 000; mortgage 142 000. Net worth = 115 600 + 42 800 + 310 000 − 142 000.
    const tile = screen.getByText("Net worth").closest("[data-state]") as HTMLElement;
    expect(within(tile).getByText(/€326,400/)).toBeTruthy();
    expect(screen.getByText(/no exchange rate to the base currency/)).toBeTruthy();
    expect(screen.getByText("US brokerage account")).toBeTruthy();
  });

  it("keeps projections apart from facts and says what they assume", async () => {
    const user = userEvent.setup();
    mount(<FinanceLens />);
    await screen.findByText("Where you stand");
    await user.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getByText(/A projection is a scenario, not a forecast/)).toBeTruthy();
    // Each input names the value it came from (it is also listed with the other planned values).
    expect(screen.getAllByText("Annual return (base)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly savings (base)").length).toBeGreaterThan(0);
    expect(screen.getByText("Investment portfolio goal")).toBeTruthy();
  });

  it("lists transactions with their account, and filters them", async () => {
    const user = userEvent.setup();
    mount(<FinanceLens />);
    await screen.findByText("Where you stand");
    await user.click(screen.getByRole("button", { name: "Transactions" }));
    expect(screen.getAllByText("Current account").length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText("Search transactions…"), "précompte");
    expect(screen.getByText("Property tax (précompte immobilier)")).toBeTruthy();
    expect(screen.queryByText("Salary")).toBeNull();
  });

  it("offers typed presets that open the shared create dialog", async () => {
    const user = userEvent.setup();
    mount(<FinanceLens />);
    await screen.findByText("Where you stand");
    await user.click(screen.getByRole("button", { name: /^Add/ }));
    await user.click(screen.getByRole("menuitem", { name: /New liability/ }));
    expect(useUi.getState().create).toMatchObject({
      type: "estimate",
      preset: { category: "liability", dataKind: "actual", currency: "EUR" },
    });
  });

  it("is an elegant empty state when there is no financial data", async () => {
    mount(<FinanceLens />, emptyFixtureData(exampleSeed()));
    expect(await screen.findByText("No financial data yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /New account/ })).toBeTruthy();
  });
});

describe("DocumentsLens", () => {
  it("lists documents with their kind, file and what they relate to", async () => {
    mount(<DocumentsLens />);
    await screen.findByText("Property tax notice 2026");
    expect(screen.getByText("Tax notes")).toBeTruthy();
    expect(screen.getAllByText(/1 memory/).length).toBeGreaterThan(0);
  });

  it("finds a document by its content, and says the match was in the content", async () => {
    const user = userEvent.setup();
    mount(<DocumentsLens />);
    await screen.findByText("Property tax notice 2026");
    await user.type(screen.getByPlaceholderText("Search name, details, content…"), "taxe fonciere");
    expect(screen.getAllByText("Tax notes").length).toBeGreaterThan(0);
    expect(screen.getByText("Found in the content")).toBeTruthy();
    expect(screen.queryByText("Marina 1BR listing (PDF)")).toBeNull();
  });

  it("is an empty state that invites an import", async () => {
    mount(<DocumentsLens />, emptyFixtureData(exampleSeed()));
    expect(await screen.findByText("No documents yet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Import/ }).length).toBeGreaterThan(0);
  });
});
