// @vitest-environment jsdom
import pkg from "../../../package.json";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { i18nCtx } from "../../../tests/support/i18n";
import { ARTIFACT_NAV } from "./artifact-nav";
import { Sidebar } from "./Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const fr = i18nCtx("fr");
const en = i18nCtx("en");

/**
 * The Claude Design artifact is the visual reference, absolutely. This pins its sidebar: exactly
 * ten entries, in its order, with its shortcuts. If this test fails, someone put the old
 * application's navigation back (or took an artifact entry out): fix the sidebar, not the test.
 */
describe("the sidebar is the artifact's", () => {
  it("has exactly the ten entries of the artifact, in its order", () => {
    expect(ARTIFACT_NAV.map((n) => fr.t(n.label))).toEqual([
      "Accueil",
      "Projets",
      "Calendrier",
      "Graphe",
      "Carte",
      "Coffre",
      "Minuteur",
      "Notes",
      "Historique",
      "Paramètres",
    ]);
    expect(ARTIFACT_NAV.map((n) => n.href)).toEqual([
      "/",
      "/projects",
      "/calendar",
      "/graph",
      "/map",
      "/documents",
      "/timer",
      "/notes",
      "/history",
      "/settings",
    ]);
    expect(ARTIFACT_NAV.map((n) => n.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
    ]);
  });

  it("renders those ten links and nothing else, with no “More” group", () => {
    render(<Sidebar />);
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(10);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(ARTIFACT_NAV.map((n) => n.href));
    expect(within(nav).queryByText(/^(More|Plus)$/)).toBeNull();
    for (const old of [
      "Timeline",
      "Chronologie",
      "Memory",
      "Mémoire",
      "Plans",
      "Tasks",
      "Finance",
      "Decisions",
      "Risks",
    ])
      expect(within(nav).queryByRole("link", { name: new RegExp(`^${old}`) })).toBeNull();
    expect(en.t(ARTIFACT_NAV[0]!.label)).toBe("Home");
  });

  it("shows the name, the version, the active entry as a card, and the mascot with its points", () => {
    render(<Sidebar />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Atlas OS")).toBeTruthy();
    expect(within(nav).getByText(new RegExp(`v${pkg.version.replace(/\./g, "\.")}`))).toBeTruthy();
    expect(within(nav).getByRole("link", { current: "page" }).getAttribute("href")).toBe(
      "/projects",
    );
    expect(within(nav).getByText(/pts/)).toBeTruthy();
  });
});
