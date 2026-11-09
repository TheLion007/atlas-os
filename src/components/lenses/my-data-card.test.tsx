// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { AtlasData, DataInfo } from "@/lib/desktop";
import { MyDataCard } from "./MyDataCard";

const counts = {
  plans: 1,
  projects: 5,
  subProjects: 12,
  tasks: 27,
  milestones: 4,
  decisions: 1,
  risks: 3,
  notes: 6,
  documents: 13,
  budgets: 0,
  events: 6,
  others: 0,
  links: 77,
  workHistory: 400,
  documentBytes: 1000,
  preferences: 4,
};
const manifest = {
  appVersion: "1.0.2",
  exportedAt: "2026-11-01T10:00:00.000Z",
  device: "PC-SALON",
  kind: "manual",
  counts,
};

const baseInfo: DataInfo = {
  dataRoot: "C:\\Users\\moi\\AppData\\Roaming\\Atlas OS",
  dbDir: "C:\\Users\\moi\\AppData\\Roaming\\Atlas OS\\data\\atlas-pgdata",
  defaultRoot: "C:\\Users\\moi\\AppData\\Roaming\\Atlas OS",
  isCustom: false,
  readOnly: false,
  device: "PC-TEST",
  autoBackup: { enabled: false, folder: null, lastDay: null, lastPath: null, lastError: null },
  importNotice: null,
};

function bridge(over: Partial<AtlasData> = {}, info: Partial<DataInfo> = {}) {
  const data: AtlasData = {
    info: vi.fn(async () => ({ ...baseInfo, ...info })),
    importNotice: vi.fn(async () => null),
    chooseSavePath: vi.fn(async () => "D:\\Sauvegardes\\AtlasOS-sauvegarde-2026-11-09.atlasbackup"),
    chooseOpenPath: vi.fn(async () => "D:\\Sauvegardes\\ok.atlasbackup"),
    chooseFolder: vi.fn(async () => "D:\\OneDrive\\Atlas"),
    previewLocation: vi.fn(async () => ({ ok: true as const, hasData: false, empty: true })),
    applyLocation: vi.fn(async () => ({ ok: true as const, mode: "move" as const })),
    restart: vi.fn(async () => true),
    savePrefs: vi.fn(async () => null),
    setAutoBackup: vi.fn(async (enabled: boolean, folder?: string | null) => ({
      ok: true as const,
      info: {
        ...baseInfo,
        autoBackup: { ...baseInfo.autoBackup, enabled, folder: folder ?? null },
      },
    })),
    runAutoBackup: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  (window as unknown as { atlasDesktop: unknown }).atlasDesktop = { data };
  return data;
}

/** A fake local server for the backup routes. */
function server(files: Record<string, unknown> = {}) {
  let polls = 0;
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
      if (url === "/api/backup/inspect")
        return json(files[body.path] ?? { ok: false, code: "not_a_backup", message: "" });
      if (url === "/api/backup/export" || url === "/api/backup/import") {
        polls = 0;
        return json({ id: 1 }, 202);
      }
      if (url === "/api/backup/status") {
        polls++;
        const last = calls
          .filter((c) => c.url === "/api/backup/export" || c.url === "/api/backup/import")
          .pop()!;
        if (polls < 2)
          return json({
            job: { id: 1, kind: "export", status: "running", phase: "x", percent: 40 },
          });
        return json({
          job:
            last.url === "/api/backup/export"
              ? {
                  id: 1,
                  kind: "export",
                  status: "done",
                  phase: "done",
                  percent: 100,
                  result: {
                    path: (last.body as { path: string }).path,
                    bytes: 2 * 1048576,
                    manifest: { counts },
                  },
                }
              : {
                  id: 1,
                  kind: "import",
                  status: "done",
                  phase: "done",
                  percent: 100,
                  result:
                    (last.body as { mode: string }).mode === "merge"
                      ? {
                          mode: "merge",
                          safetyBackup: "D:\\secu.atlasbackup",
                          summary: { itemsAdded: 3, itemsUpdated: 1, itemsKept: 50, skipped: 0 },
                        }
                      : {
                          mode: "replace",
                          needsRestart: true,
                          safetyBackup: "D:\\secu.atlasbackup",
                        },
                },
        });
      }
      return json({});
    }),
  );
  return calls;
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider initial="fr">
        <MyDataCard />
      </I18nProvider>
    </QueryClientProvider>,
  );

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { atlasDesktop?: unknown }).atlasDesktop;
});

describe("Mes données", () => {
  it("shows nothing outside the desktop app", () => {
    const { container } = mount();
    expect(container.textContent).toBe("");
  });

  it("exports: the Windows save dialog, a progress bar, then the file's path", async () => {
    const data = bridge();
    const calls = server();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Exporter mes données" }));
    expect(data.chooseSavePath).toHaveBeenCalled();
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(await screen.findByText("Sauvegarde enregistrée.")).toBeTruthy();
    expect(
      screen.getByText(/D:\\Sauvegardes\\AtlasOS-sauvegarde-2026-11-09\.atlasbackup/),
    ).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/backup/export")?.body).toMatchObject({
      path: "D:\\Sauvegardes\\AtlasOS-sauvegarde-2026-11-09.atlasbackup",
    });
  });

  it("does nothing when the save dialog is cancelled", async () => {
    bridge({ chooseSavePath: vi.fn(async () => null) });
    const calls = server();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Exporter mes données" }));
    expect(calls).toHaveLength(0);
  });

  it("says plainly what is wrong with a file that is not a good backup", async () => {
    const data = bridge();
    (data.chooseOpenPath as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("D:\\abime.atlasbackup")
      .mockResolvedValueOnce("D:\\futur.atlasbackup")
      .mockResolvedValueOnce("D:\\texte.atlasbackup");
    server({
      "D:\\abime.atlasbackup": { ok: false, code: "corrupt", message: "" },
      "D:\\futur.atlasbackup": { ok: false, code: "newer_version", message: "" },
      "D:\\texte.atlasbackup": { ok: false, code: "not_a_backup", message: "" },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Importer des données" }));
    expect((await screen.findByRole("alert")).textContent).toContain("abîmé ou incomplet");
    await user.click(screen.getByRole("button", { name: "Importer des données" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("version plus récente"),
    );
    await user.click(screen.getByRole("button", { name: "Importer des données" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("n’est pas une sauvegarde Atlas OS"),
    );
  });

  it("shows what the backup holds, then merges", async () => {
    bridge();
    const calls = server({
      "D:\\Sauvegardes\\ok.atlasbackup": {
        ok: true,
        manifest,
        counts,
        fileBytes: 3000,
        migrated: true,
      },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Importer des données" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("PC-SALON");
    expect(dialog.textContent).toContain("5 projets");
    expect(dialog.textContent).toContain("13 documents");
    expect(dialog.textContent).toContain("400 entrées d’historique de travail");
    expect(dialog.textContent).toContain("mise à jour automatiquement"); // an older version
    await user.click(
      within(dialog).getByRole("button", { name: /Fusionner avec mes données actuelles/ }),
    );
    expect(await screen.findByText(/3 ajoutés, 1 mis à jour/)).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/backup/import")?.body).toMatchObject({
      mode: "merge",
    });
  });

  it("replacing needs a second, clear confirmation, and restarts the app", async () => {
    const data = bridge();
    const calls = server({
      "D:\\Sauvegardes\\ok.atlasbackup": {
        ok: true,
        manifest,
        counts,
        fileBytes: 3000,
        migrated: false,
      },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Importer des données" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /Remplacer toutes mes données/,
      }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("Impossible d’annuler depuis l’application");
    expect(confirm.textContent).toContain("sauvegarde de sécurité");
    expect(calls.some((c) => c.url === "/api/backup/import")).toBe(false); // nothing yet
    await user.click(within(confirm).getByRole("button", { name: "Annuler" }));
    expect(calls.some((c) => c.url === "/api/backup/import")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Importer des données" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /Remplacer toutes mes données/,
      }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Oui, remplacer mes données",
      }),
    );
    expect(await screen.findByText("Tes données sont prêtes. Atlas OS redémarre…")).toBeTruthy();
    await waitFor(() => expect(data.restart).toHaveBeenCalled(), { timeout: 4000 });
    expect(calls.find((c) => c.url === "/api/backup/import")?.body).toMatchObject({
      mode: "replace",
    });
  });

  it("changing the data folder: an empty folder offers to move, a full one to use what is there", async () => {
    const data = bridge();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Changer…" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("ne contient pas encore");
    expect(within(dialog).getByRole("button", { name: /Déplacer mes données ici/ })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

    (data.previewLocation as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      hasData: true,
      empty: false,
    });
    await user.click(screen.getByRole("button", { name: "Changer…" }));
    dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("contient déjà des données");
    expect(within(dialog).queryByRole("button", { name: /Déplacer mes données ici/ })).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: /Utiliser les données déjà présentes/ }),
    );
    expect(data.applyLocation).toHaveBeenCalledWith("D:\\OneDrive\\Atlas", "use");
    expect(await screen.findByText(/redémarre sur le nouveau dossier/)).toBeTruthy();
  });

  it("explains a folder that cannot be used", async () => {
    bridge({ previewLocation: vi.fn(async () => ({ ok: false as const, code: "not_writable" })) });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Changer…" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "ne peut pas écrire dans ce dossier",
    );
  });

  it("automatic backup: asks for a folder when switched on without one, and keeps 7 (said in the text)", async () => {
    const data = bridge();
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText(/garde les 7 dernières/)).toBeTruthy();
    await user.click(
      screen.getByRole("switch", { name: "Sauvegarder automatiquement chaque jour" }),
    );
    expect(data.chooseFolder).toHaveBeenCalled();
    expect(data.setAutoBackup).toHaveBeenCalledWith(true, "D:\\OneDrive\\Atlas");
    await waitFor(() =>
      expect(
        screen
          .getByRole("switch", { name: "Sauvegarder automatiquement chaque jour" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("read-only mode: says so and refuses to import, move or back up", async () => {
    bridge({}, { readOnly: true });
    mount();
    expect(await screen.findByText(/Mode lecture seule/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Importer des données" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Changer…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Exporter mes données" }) as HTMLButtonElement).disabled,
    ).toBe(false); // reading out is fine
  });
});
