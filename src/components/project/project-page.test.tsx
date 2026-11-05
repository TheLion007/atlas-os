// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "@/client/fixture-source";
import { AtlasProvider } from "@/client/provider";
import { ProjectsLens } from "../lenses/ProjectsLens";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { neutralSeed } from "@/seed/neutral-fr";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const data = buildFixtureData(neutralSeed());

function mount() {
  const source = createFixtureSource(data);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AtlasProvider mode="demo" source={source} queryClient={queryClient}>
      <ProjectsLens />
    </AtlasProvider>,
  );
  return source;
}

describe("Projects, as the design draws it", () => {
  it("is the project itself with the row of projects on top and the six tabs", async () => {
    mount();
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    const row = screen.getByRole("navigation", { name: /Projects|Projets/ });
    expect(within(row).getAllByRole("link")).toHaveLength(5);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Overview",
      "Tasks",
      "Notes",
      "Files",
      "Timeline",
      "Budget and risks",
    ]);
  });

  it("opens on the board, with a column per stage and a card leading to each task", async () => {
    mount();
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    expect(screen.getByRole("region", { name: "To do" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "In progress" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Done" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Maquettes de la page tarifs" });
    expect(link.getAttribute("href")).toBe(`/objects/${seedId("t_web1")}`);
  });

  it("ticking a card finishes the task and records the advance", async () => {
    const source = mount();
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    const before = (await source.progress(30)).length;
    const card = screen.getByRole("listitem", { name: /Maquettes de la page tarifs/ });
    fireEvent.click(within(card).getByRole("button", { name: /Finish the task/ }));
    await waitFor(async () => expect((await source.progress(30)).length).toBe(before + 1));
  });

  it("the overview shows the milestones, decisions, risks and the project's own activity", async () => {
    mount();
    await screen.findByRole("heading", { name: "Refonte du site web", level: 1 });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Progress timeline" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Decisions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Risks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Activity on this project" })).toBeTruthy();
  });
});
