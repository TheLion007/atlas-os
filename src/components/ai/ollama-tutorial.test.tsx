// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OllamaState } from "@/domain/ollama";
import { axeViolations } from "../../../tests/support/a11y";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useUi } from "../shell/ui-store";
import { OllamaTutorial } from "./OllamaTutorial";
import type { UseOllama } from "./use-ollama";

const ollama = (state: OllamaState, over: Partial<UseOllama> = {}): UseOllama => ({
  pending: false,
  state,
  status: {
    reachable: state !== "off",
    models: state === "ready" ? [{ name: "llama3.2:3b", sizeBytes: 1 }] : [],
  },
  model: state === "ready" ? "llama3.2:3b" : null,
  checking: false,
  check: vi.fn(async () => ({ reachable: state !== "off", models: [] })),
  ...over,
});

function mount(o: UseOllama, later = vi.fn(), done = vi.fn()) {
  const view = render(
    <I18nProvider initial="fr">
      <OllamaTutorial ollama={o} onLater={later} onDone={done} />
    </I18nProvider>,
  );
  return { later, done, ...view };
}

beforeEach(() => {
  useUi.setState({ toasts: [] });
});

describe("the Ollama tutorial", () => {
  it("reassures first, and is a real stepper with no accessibility violations", async () => {
    const { container } = mount(ollama("off"));
    expect(screen.getByText(/Rien n’est envoyé sur internet/)).toBeTruthy();
    expect(screen.getByText(/peut être lent/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("starts at the right step for what it finds", () => {
    const a = mount(ollama("off"));
    expect(screen.getByRole("heading", { name: "Installe Ollama" })).toBeTruthy();
    a.unmount();
    const b = mount(ollama("no-model"));
    expect(screen.getByRole("heading", { name: "Télécharge un modèle" })).toBeTruthy();
    expect(screen.getByText(/Ollama est bien installé/)).toBeTruthy();
    b.unmount();
    mount(ollama("ready"));
    expect(screen.getByText(/C’est connecté/)).toBeTruthy();
    expect(screen.getByText(/Le modèle llama3.2:3b est prêt/)).toBeTruthy();
  });

  it("opens the download page in the browser", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mount(ollama("off"));
    await userEvent.click(screen.getByRole("button", { name: /Télécharger Ollama/ }));
    expect(open).toHaveBeenCalledWith(
      "https://ollama.com/download",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("offers the two models and copies the command of the one chosen", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(ollama("no-model"));
    expect(screen.getByText("llama3.2:3b")).toBeTruthy();
    expect(screen.getByText("qwen2.5:7b")).toBeTruthy();
    expect(screen.getByText(/touche Windows/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copier la commande" }));
    expect(writeText).toHaveBeenLastCalledWith("ollama pull llama3.2:3b");
    expect(await screen.findByRole("button", { name: "Copiée ✓" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /qwen2.5:7b/ }));
    await user.click(screen.getByRole("button", { name: "Copier la commande" }));
    expect(writeText).toHaveBeenLastCalledWith("ollama pull qwen2.5:7b");
    expect(useUi.getState().toasts.length).toBeGreaterThan(0);
  });

  it("tests the connection on demand and says what it found", async () => {
    const user = userEvent.setup();
    const o = ollama("off");
    mount(o);
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await user.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(o.check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Je ne vois pas encore Ollama/)).toBeTruthy();
  });

  it("can be walked back and forth, and left for later", async () => {
    const user = userEvent.setup();
    const { later, done } = mount(ollama("ready"));
    await user.click(screen.getByRole("button", { name: "Précédent" }));
    expect(screen.getByRole("heading", { name: "Télécharge un modèle" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(later).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  it("ends on a Start button once connected", async () => {
    const { done } = mount(ollama("ready"));
    await userEvent.click(screen.getByRole("button", { name: "Commencer" }));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
