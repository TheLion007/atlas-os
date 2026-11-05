// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { AtlasUpdates, UpdateState } from "@/lib/desktop";
import { UpdateNotice } from "./UpdateNotice";

const base: UpdateState = {
  current: "1.0.0",
  supported: true,
  auto: true,
  status: "idle",
  latest: null,
  percent: 0,
  error: null,
  errorWhile: null,
  checkedAt: null,
};

/** A desktop bridge that holds one state and lets the test move it. */
function bridge(initial: UpdateState) {
  let state = initial;
  const listeners = new Set<(s: UpdateState) => void>();
  const api = {
    state: vi.fn(async () => state),
    check: vi.fn(async () => state),
    download: vi.fn(async () => state),
    install: vi.fn(async () => state),
    setAuto: vi.fn(async () => state),
    onState: (cb: (s: UpdateState) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } satisfies AtlasUpdates;
  (window as unknown as { atlasDesktop: unknown }).atlasDesktop = { updates: api };
  return {
    api,
    push: (patch: Partial<UpdateState>) => {
      state = { ...state, ...patch };
      act(() => listeners.forEach((l) => l(state)));
    },
  };
}

const mount = () =>
  render(
    <I18nProvider initial="fr">
      <UpdateNotice />
    </I18nProvider>,
  );

afterEach(() => {
  delete (window as unknown as { atlasDesktop?: unknown }).atlasDesktop;
});

describe("the update notice", () => {
  it("shows nothing on the web, nothing when up to date, and nothing for a failed check", async () => {
    mount();
    expect(screen.queryByRole("status")).toBeNull();
    const b = bridge({ ...base, status: "uptodate" });
    mount();
    await act(async () => {});
    expect(screen.queryByText("Nouvelle version disponible")).toBeNull();
    b.push({ status: "error", error: "offline", errorWhile: "check" });
    expect(screen.queryByText("Nouvelle version disponible")).toBeNull();
  });

  it("offers the download, then the restart, with the data kept", async () => {
    const user = userEvent.setup();
    const b = bridge({ ...base, status: "available", latest: "1.0.1" });
    mount();
    expect(await screen.findByText("Nouvelle version disponible")).toBeTruthy();
    expect(screen.getByText(/Atlas OS 1\.0\.1 est prêt/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Télécharger" }));
    expect(b.api.download).toHaveBeenCalledOnce();

    b.push({ status: "downloading", percent: 42 });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(screen.queryByRole("button", { name: "Télécharger" })).toBeNull();

    b.push({ status: "ready", percent: 100 });
    expect(screen.getByText("Mise à jour prête")).toBeTruthy();
    expect(screen.getByText(/Tes données restent en place/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Redémarrer et installer" }));
    expect(b.api.install).toHaveBeenCalledOnce();
  });

  it("can be put off for this version, and says so plainly when a download breaks", async () => {
    const user = userEvent.setup();
    const b = bridge({ ...base, status: "available", latest: "1.0.1" });
    mount();
    await user.click(await screen.findByRole("button", { name: "Plus tard" }));
    expect(screen.queryByText("Nouvelle version disponible")).toBeNull();
    b.push({ error: "interrupted", errorWhile: "download" });
    expect(screen.getByText(/téléchargement a été interrompu/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Télécharger" })).toBeTruthy();
  });
});
