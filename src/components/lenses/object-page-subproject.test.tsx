// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { seedId } from "@/seed/seed-types";
import { useTimer } from "@/lib/timer-store";
import { ObjectPageView } from "./ObjectPageView";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/objects/x",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

const data = buildFixtureData(neutralSeed());

function mount(key: string) {
  const source = createFixtureSource(data);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AtlasProvider mode="demo" source={source} queryClient={queryClient}>
      <ObjectPageView id={seedId(key)} />
    </AtlasProvider>,
  );
}

const TABS = ["Overview", "Tasks", "Notes", "Files", "Timeline", "Budget and risks"];

describe("a sub-project opens the same page as a project", () => {
  it("has the header, the six tabs and the focus button of a project", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(TABS);
    expect(screen.getByRole("button", { name: /Focus/ })).toBeTruthy();
    // not the generic "Object" page, with its "Derived" block
    expect(screen.queryByText("Derived")).toBeNull();
  });

  it("is labelled Sub-project, and leads back to its project", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    expect(screen.getByText(/^Sub-project \//)).toBeTruthy();
    const back = screen.getByRole("link", { name: /Back to the project Refonte du site web/ });
    expect(back.getAttribute("href")).toBe(`/objects/${seedId("p_web")}`);
  });

  it("the breadcrumb goes Projects / project / sub-project", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    const crumbs = screen.getByRole("navigation", { name: /Breadcrumb|Fil d/ });
    const links = within(crumbs).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Home", "Projects", "Refonte du site web"]);
    expect(within(crumbs).getByText("Pages produit")).toBeTruthy();
  });

  it("shows the progress worked out from its own tasks, and only its own tasks on the board", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    const ring = screen.getByRole("progressbar", { name: /Pages produit/ });
    expect(ring.textContent).toContain("20");
    expect(screen.getByRole("link", { name: "Maquettes de la page tarifs" })).toBeTruthy();
    // a task of another sub-project of the same project is not here
    expect(screen.queryByRole("link", { name: "Audit de contraste (AA)" })).toBeNull();
  });

  it("the overview has the decisions, risks, reminders and activity blocks", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Progress timeline" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Decisions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Risks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reminders" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Activity on this sub-project" })).toBeTruthy();
    // its dated task shows up as a reminder
    expect(
      screen.getAllByRole("link", { name: /Maquettes de la page tarifs/ }).length,
    ).toBeGreaterThan(0);
  });

  it("focusing from a sub-project targets its project in the timer", async () => {
    mount("s_web_a");
    await screen.findByRole("heading", { name: "Pages produit", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Focus/ }));
    expect(useTimer.getState().projectId).toBe(seedId("p_web"));
    expect(push).toHaveBeenCalled();
  });

  it("the project page itself is unchanged: Projects label, its sub-projects, no way back", async () => {
    mount("p_web");
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(TABS);
    expect(screen.getByRole("link", { name: /^Pages produit/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Back to the project/ })).toBeNull();
    expect(screen.queryByText(/^Sub-project \//)).toBeNull();
  });

  it("a sub-project's reminder also shows in its project, once", async () => {
    mount("p_web");
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    const reminders = (await screen.findByRole("heading", { name: "Reminders" })).closest(
      "section",
    );
    const lines = within(reminders as HTMLElement).getAllByRole("link");
    const titles = lines.map((l) => l.textContent ?? "");
    expect(titles.some((x) => x.includes("Audit de contraste (AA)"))).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
