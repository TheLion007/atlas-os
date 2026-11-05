// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "@/client/provider";
import { createFixtureSource } from "@/client/fixture-source";
import type { AtlasDataSource } from "@/client/data-source";
import { planDeletion } from "@/domain/deletion";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useAssistantUndo } from "@/lib/assistant-undo";
import { useDeletion } from "@/lib/deletion-store";
import { usePrefs } from "@/lib/feedback/prefs";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { DeleteBanner, DeleteHost } from "./DeleteHost";
import { DeleteButton } from "./DeleteButton";
import { Toaster } from "./Toaster";

let search = "";
let pathname = "/";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const data = () => buildFixtureData(neutralSeed());

function mount(source: AtlasDataSource, ui: React.ReactNode = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AtlasProvider mode="demo" source={source} queryClient={queryClient}>
      <I18nProvider initial="fr">
        {ui}
        <DeleteHost />
        <DeleteBanner />
        <Toaster />
      </I18nProvider>
    </AtlasProvider>,
  );
}

beforeEach(() => {
  search = "";
  pathname = "/";
  push.mockClear();
  useDeletion.setState({ confirmId: null, pending: [], menu: null, selection: null });
  useAssistantUndo.setState({ batch: null });
  usePrefs.setState({ points: 10 });
});
afterEach(() => vi.useRealTimers());

/** An object with nothing under it, and a project that holds several things. */
function pick() {
  const d = data();
  const lone = d.nodes.find(
    (n) => n.type === "task" && planDeletion(d.nodes, d.edges, n.id)!.extra === 0,
  )!;
  const project = d.nodes.find(
    (n) => n.type === "project" && planDeletion(d.nodes, d.edges, n.id)!.counts.subProjects > 0,
  )!;
  return { d, lone, project };
}

describe("deleting from the interface", () => {
  it("deletes an object that is alone at once, with a banner to undo it", async () => {
    const { d, lone } = pick();
    const source = createFixtureSource(d);
    const user = userEvent.setup();
    mount(source, <DeleteButton id={lone.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByText(`Supprimé : ${lone.title}`)).toBeTruthy();
    expect((await source.graph()).nodes.some((n) => n.id === lone.id)).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull(); // no confirmation for a lone object

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(async () =>
      expect((await source.graph()).nodes.some((n) => n.id === lone.id)).toBe(true),
    );
    expect(await screen.findByText(`Rétabli : ${lone.title}`)).toBeTruthy();
    expect(screen.queryByText(`Supprimé : ${lone.title}`)).toBeNull();
  });

  it("says exactly what goes, with the numbers, before deleting a project", async () => {
    const { d, project } = pick();
    const source = createFixtureSource(d);
    const plan = planDeletion(d.nodes, d.edges, project.id)!;
    const user = userEvent.setup();
    mount(source, <DeleteButton id={project.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    const dialog = await screen.findByRole("alertdialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain(`Supprimer « ${project.title} » ?`);
    expect(text).toMatch(new RegExp(`${plan.counts.subProjects} sous-projets?`));
    expect(text).toMatch(new RegExp(`${plan.counts.tasks} tâches?`));
    // nothing is deleted before the person agrees
    expect((await source.graph()).nodes.some((n) => n.id === project.id)).toBe(true);

    await user.click(
      within(dialog).getByRole("button", { name: `Tout supprimer · ${1 + plan.extra}` }),
    );
    const graph = await source.graph();
    expect(graph.nodes.some((n) => plan.all.includes(n.id))).toBe(false);
    expect(
      await screen.findByText(`Supprimé : ${project.title} et ${plan.extra} autres`),
    ).toBeTruthy();

    // one click brings all of it back
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(async () =>
      expect((await source.graph()).nodes.filter((n) => plan.all.includes(n.id))).toHaveLength(
        plan.all.length,
      ),
    );
  });

  it("offers to delete only the object and keep what it holds, when the model allows it", async () => {
    const d = data();
    const sub = d.nodes.find((n) => {
      const p = planDeletion(d.nodes, d.edges, n.id)!;
      return n.type === "sub_project" && p.canKeepChildren && p.extra > 0;
    })!;
    const plan = planDeletion(d.nodes, d.edges, sub.id)!;
    const source = createFixtureSource(d);
    const user = userEvent.setup();
    mount(source, <DeleteButton id={sub.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Supprimer seulement cet élément" }),
    );
    const graph = await source.graph();
    expect(graph.nodes.some((n) => n.id === sub.id)).toBe(false);
    for (const other of plan.others.filter((o) => plan.keep.reattach.some((r) => r.to === o.id)))
      expect(graph.nodes.some((n) => n.id === other.id)).toBe(true);
    for (const r of plan.keep.reattach)
      expect(graph.edges.some((e) => e.kind === r.kind && e.from === r.from && e.to === r.to)).toBe(
        true,
      );
  });

  it("does not offer it when the children could not sit under the parent", async () => {
    const d = data();
    const project = d.nodes.find((n) => {
      const p = planDeletion(d.nodes, d.edges, n.id)!;
      return n.type === "project" && p.extra > 0 && !p.canKeepChildren;
    })!;
    const user = userEvent.setup();
    mount(createFixtureSource(d), <DeleteButton id={project.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).queryByRole("button", { name: "Supprimer seulement cet élément" }),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await createFixtureSource(d).graph()).nodes.some((n) => n.id === project.id)).toBe(
      true,
    );
  });

  it("deletes the open object with the Del key, and undoes it with Ctrl+Z", async () => {
    const { d, lone } = pick();
    const source = createFixtureSource(d);
    search = `peek=${lone.id}`;
    mount(source);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(await screen.findByText(`Supprimé : ${lone.title}`)).toBeTruthy();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(async () =>
      expect((await source.graph()).nodes.some((n) => n.id === lone.id)).toBe(true),
    );
  });

  it("leaves the Del key alone while typing or while a dialog is open", async () => {
    const { d, lone } = pick();
    const source = createFixtureSource(d);
    search = `peek=${lone.id}`;
    mount(source, <input aria-label="champ" />);
    fireEvent.keyDown(screen.getByLabelText("champ"), { key: "Delete" });
    await act(async () => {});
    expect((await source.graph()).nodes.some((n) => n.id === lone.id)).toBe(true);
    expect(screen.queryByText(`Supprimé : ${lone.title}`)).toBeNull();
  });

  it("opens an object menu on a right-click and deletes from it", async () => {
    const { d, lone } = pick();
    const source = createFixtureSource(d);
    const user = userEvent.setup();
    mount(source, <a href={`/objects/${lone.id}?x=1`}>{lone.title}</a>);
    fireEvent.contextMenu(screen.getByText(lone.title));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Ouvrir" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: /Supprimer/ }));
    expect(await screen.findByText(`Supprimé : ${lone.title}`)).toBeTruthy();
    expect((await source.graph()).nodes.some((n) => n.id === lone.id)).toBe(false);
  });

  it("goes back home when the page of the deleted object was open", async () => {
    const { d, lone } = pick();
    pathname = `/objects/${lone.id}`;
    const user = userEvent.setup();
    mount(createFixtureSource(d), <DeleteButton id={lone.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByText(`Supprimé : ${lone.title}`);
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/(\?|$)/));
  });

  it("takes back the points the assistant gave for what is deleted, and gives them back on undo", async () => {
    const { d, lone } = pick();
    useAssistantUndo.setState({ batch: { objectIds: ["x", lone.id], edgeIds: [] } });
    const user = userEvent.setup();
    mount(createFixtureSource(d), <DeleteButton id={lone.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByText(`Supprimé : ${lone.title}`);
    expect(usePrefs.getState().points).toBe(8); // 2 points per thing the assistant created
    expect(useAssistantUndo.getState().batch?.objectIds).toEqual(["x"]);
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(usePrefs.getState().points).toBe(10));
    expect(useAssistantUndo.getState().batch?.objectIds).toEqual(["x", lone.id]);
  });

  it("does not touch the points of what the assistant did not create", async () => {
    const { d, lone } = pick();
    const user = userEvent.setup();
    mount(createFixtureSource(d), <DeleteButton id={lone.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByText(`Supprimé : ${lone.title}`);
    expect(usePrefs.getState().points).toBe(10);
  });

  it("makes the deletion final after the delay, and warns when documents are involved", async () => {
    const d = data();
    const doc = d.nodes.find((n) => n.type === "document");
    const target = doc ?? pick().lone;
    const source = createFixtureSource(d);
    const purge = vi.spyOn(source, "purgeMany");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount(source, <DeleteButton id={target.id} />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByText(`Supprimé : ${target.title}`);
    if (doc)
      expect(screen.getByText("Les documents seront supprimés définitivement.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });
    expect(purge).toHaveBeenCalledWith({ ids: [target.id] });
    expect(screen.queryByText(`Supprimé : ${target.title}`)).toBeNull();
    // final: it can no longer be undone
    expect(useDeletion.getState().pending).toHaveLength(0);
  });
});
