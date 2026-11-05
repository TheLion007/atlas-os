// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { TerritoryMap } from "./TerritoryMap";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const data = buildFixtureData(neutralSeed());

function mount(ui = <TerritoryMap />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={createFixtureSource(data)} queryClient={queryClient}>
      {ui}
    </AtlasProvider>,
  );
}

describe("the Map of the design", () => {
  it("shows one territory per domain with the projects as markers", async () => {
    mount();
    for (const domain of ["Web", "Produit", "Docs", "Infra", "Recherche"])
      expect(await screen.findByText(domain)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refonte du site web" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pages produit" })).toBeTruthy();
  });

  it("opens the card of a project and leads to its real page", async () => {
    mount();
    const marker = await screen.findByRole("button", { name: "Lancement v2.1" });
    fireEvent.click(marker);
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("Lancement v2.1")).toBeTruthy();
    expect(within(panel).getByText("Produit")).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", { name: /Open the project|Ouvrir le projet/ }),
    );
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/objects\//));
  });

  it("regroups by priority and by progress, and closes the card", async () => {
    mount();
    await screen.findByRole("button", { name: "Lancement v2.1" });
    fireEvent.click(screen.getByRole("button", { name: /Priority|Priorité/ }));
    expect(screen.getAllByText(/Critical|Critique/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Progress|Avancement/ }));
    expect(screen.getByText("75 – 100 %")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lancement v2.1" }));
    fireEvent.click(screen.getByRole("button", { name: /Close|Fermer/ }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
