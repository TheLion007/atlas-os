"use client";

import { useState } from "react";
import { DOWNLOAD_URL, pullCommand, RECOMMENDED } from "@/domain/ollama";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { playSound } from "@/lib/feedback/sound";
import { useUi } from "../shell/ui-store";
import type { UseOllama } from "./use-ollama";

type Step = 1 | 2 | 3;

const primary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[12px] bg-accent px-4 text-[13.5px] font-semibold text-on-accent transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96] disabled:opacity-60 disabled:hover:translate-y-0";
const secondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border border-border-strong bg-surface px-4 text-[13.5px] font-semibold transition-[background-color,transform] duration-300 ease-(--ease-spring) hover:bg-sunk active:scale-[0.96] disabled:opacity-50";

/** Where the detection currently stands, as a step: nothing → 1, no model yet → 2, ready → 3. */
const stepFor = (state: UseOllama["state"]): Step =>
  state === "off" ? 1 : state === "no-model" ? 2 : 3;

/**
 * The three-step guide that connects the Ollama on this PC. It follows the detection on its own
 * (the parent polls while it is open) and can also be walked by hand. Closing it ("Plus tard")
 * leaves the whole app working; only the AI answers stay off.
 */
export function OllamaTutorial({
  ollama,
  onLater,
  onDone,
}: {
  ollama: UseOllama;
  onLater: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const pushToast = useUi((s) => s.pushToast);
  const react = useFeedback((s) => s.react);
  const [choice, setChoice] = useState<(typeof RECOMMENDED)[number]["id"]>("small");
  const [copied, setCopied] = useState(false);
  const [tested, setTested] = useState(false);
  // The step follows the detection; going back or forward by hand holds until the detection moves.
  const auto = stepFor(ollama.state);
  const [manual, setManual] = useState<{ auto: Step; step: Step } | null>(null);
  const step: Step = manual && manual.auto === auto ? manual.step : auto;
  const go = (s: Step) => {
    playSound("click");
    setManual({ auto, step: s });
  };

  const picked = RECOMMENDED.find((r) => r.id === choice) ?? RECOMMENDED[0];
  const command = pullCommand(picked.model);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Clipboard blocked: fall back to selecting the text, which the person can copy by hand.
      try {
        const area = document.createElement("textarea");
        area.value = command;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error("copy refused");
      } catch {
        playSound("error");
        pushToast(t("ai.s2.copyFailed"));
        return;
      }
    }
    playSound("check");
    setCopied(true);
    pushToast(t("ai.s2.copiedToast"));
    window.setTimeout(() => setCopied(false), 2200);
  };

  const test = async () => {
    playSound("click");
    setTested(false);
    const found = await ollama.check();
    setTested(true);
    if (found.reachable && found.models.length > 0) {
      playSound("create");
      react("cheer", t("ai.s3.ok"));
    } else playSound("error");
  };

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: t("ai.s1.title") },
    { n: 2, label: t("ai.s2.title") },
    { n: 3, label: t("ai.s3.title") },
  ];
  const ready = ollama.state === "ready";

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="min-h-0 grow overflow-y-auto px-5 pt-4 pb-5">
        <p className="flex items-start gap-3 rounded-[14px] bg-accent-soft px-4 py-3 text-[13px] leading-[1.45] font-semibold">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent-ink)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-px flex-none"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
            <path d="M9.5 12l2 2 3.5-4" />
          </svg>
          {t("ai.reassure")}
        </p>

        <div className="mt-4">
          <h3 className="font-display text-[19px] leading-tight font-bold">{t("ai.title")}</h3>
          <p className="text-[12.5px] text-fg-muted">{t("ai.sub")}</p>
        </div>

        <ol aria-label={t("ai.steps")} className="mt-4 flex items-center">
          {steps.map((s, i) => {
            const done = s.n < auto || (ready && s.n <= 3 && s.n < step);
            const current = s.n === step;
            return (
              <li key={s.n} className="flex flex-1 items-center last:flex-none">
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  aria-label={`${t("ai.step", { n: s.n })} · ${s.label}`}
                  onClick={() => go(s.n)}
                  className={cn(
                    "grid size-8 flex-none place-items-center rounded-full border-2 text-[12.5px] font-bold transition-[background-color,border-color,transform] duration-300 ease-(--ease-spring) hover:scale-110",
                    current
                      ? "border-accent bg-accent text-on-accent"
                      : done
                        ? "border-accent bg-accent-soft text-accent-ink"
                        : "border-border-strong bg-surface text-fg-subtle",
                  )}
                >
                  {done && !current ? "✓" : s.n}
                </button>
                {i < steps.length - 1 && (
                  <span className="mx-2 h-[2px] flex-1 rounded-full bg-border-strong">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-500"
                      style={{ width: s.n < step || s.n < auto ? "100%" : "0%" }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <section
          key={step}
          aria-label={steps[step - 1]?.label}
          className="pop-in mt-4 flex flex-col gap-3 rounded-[18px] border border-border bg-surface p-4 shadow-card"
        >
          <header>
            <span className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              {t("ai.step", { n: step })}
            </span>
            <h4 className="font-display text-[17px] font-bold">{steps[step - 1]?.label}</h4>
          </header>

          {step === 1 && (
            <>
              <p className="text-[13px] leading-[1.5] text-fg-muted">{t("ai.s1.body")}</p>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  playSound("click");
                  window.open(DOWNLOAD_URL, "_blank", "noopener,noreferrer");
                }}
              >
                {t("ai.s1.download")}
                <span aria-hidden="true">↗</span>
              </button>
              <Waiting text={t("ai.s1.waiting")} />
            </>
          )}

          {step === 2 && (
            <>
              {ollama.state !== "off" && (
                <p className="rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] font-semibold text-positive">
                  {t("ai.s2.found")}
                </p>
              )}
              <p className="text-[13px] leading-[1.5] text-fg-muted">{t("ai.s2.body")}</p>
              <div role="radiogroup" aria-label={t("ai.s2.title")} className="flex flex-col gap-2">
                {RECOMMENDED.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={choice === r.id}
                    onClick={() => {
                      playSound("click");
                      setChoice(r.id);
                      setCopied(false);
                    }}
                    className={cn(
                      "flex flex-col gap-[2px] rounded-[14px] border-2 px-4 py-3 text-left transition-[border-color,transform] duration-200 hover:-translate-y-px",
                      choice === r.id ? "border-accent bg-accent-soft/50" : "border-border",
                    )}
                  >
                    <span className="text-[13.5px] font-semibold">
                      {t(r.id === "small" ? "ai.s2.small" : "ai.s2.large")}
                    </span>
                    <span className="num text-[12px] text-fg-muted">{r.model}</span>
                    <span className="text-[12px] text-fg-subtle">
                      {t("ai.s2.size", { gb: r.sizeGb })} ·{" "}
                      {t(r.ramKind === "min" ? "ai.s2.ramMin" : "ai.s2.ramReco", { gb: r.ramGb })}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-[12px] bg-code px-3 py-2 text-code-ink">
                <code className="num min-w-0 flex-1 truncate text-[13px] select-all">
                  {command}
                </code>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="shrink-0 rounded-[9px] bg-code-ink/15 px-3 py-[6px] text-[12px] font-semibold transition-colors hover:bg-code-ink/25 active:scale-95"
                >
                  {copied ? t("ai.s2.copied") : t("ai.s2.copy")}
                </button>
              </div>
              <div className="rounded-[12px] bg-sunk px-3 py-3 text-[12.5px] leading-[1.5]">
                <p className="font-semibold">{t("ai.s2.terminalTitle")}</p>
                <p className="text-fg-muted">{t("ai.s2.terminal")}</p>
                <p className="mt-1 text-fg-muted">{t("ai.s2.paste")}</p>
              </div>
              <Waiting text={t("ai.s2.waiting")} />
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-[13px] leading-[1.5] text-fg-muted">{t("ai.s3.body")}</p>
              <button
                type="button"
                className={primary}
                disabled={ollama.checking}
                onClick={() => void test()}
              >
                {ollama.checking ? t("ai.testing") : t("ai.test")}
              </button>
              {ready ? (
                <div
                  role="status"
                  className="pop-in flex flex-col gap-1 rounded-[14px] bg-accent-soft px-4 py-3"
                >
                  <span className="text-[14px] font-bold">✓ {t("ai.s3.ok")}</span>
                  <span className="text-[12.5px] leading-[1.45] text-fg-muted">
                    {t("ai.s3.okBody", { model: ollama.model ?? "" })}
                  </span>
                  <button type="button" onClick={onDone} className={cn(primary, "mt-2 self-start")}>
                    {t("ai.s3.start")}
                  </button>
                </div>
              ) : (
                tested && (
                  <p
                    role="status"
                    className="rounded-[14px] bg-sunk px-4 py-3 text-[12.5px] leading-[1.45] text-fg-muted"
                  >
                    {ollama.state === "off" ? t("ai.s3.offBody") : t("ai.s3.noModelBody")}
                  </p>
                )
              )}
            </>
          )}
        </section>

        <p className="mt-3 text-[12px] leading-[1.45] text-fg-subtle">{t("ai.slow")}</p>
      </div>

      <div className="flex items-center gap-2 border-t border-border py-3 pr-14 pl-5">
        <button
          type="button"
          className={secondary}
          disabled={step === 1}
          onClick={() => go((step - 1) as Step)}
        >
          {t("ai.back")}
        </button>
        <button
          type="button"
          className={secondary}
          disabled={step === 3}
          onClick={() => go((step + 1) as Step)}
        >
          {t("ai.next")}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            playSound("click");
            onLater();
          }}
          className="h-10 rounded-[12px] px-3 text-[13px] font-semibold text-fg-muted transition-colors hover:bg-sunk hover:text-fg"
        >
          {t("ai.later")}
        </button>
      </div>
    </div>
  );
}

/** A pulsing dot and a line: the page is watching for the step to be done. */
function Waiting({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[12px] text-fg-subtle">
      <span className="relative grid size-3 place-items-center" aria-hidden="true">
        <span className="absolute size-3 animate-ping rounded-full bg-accent/40" />
        <span className="size-[6px] rounded-full bg-accent" />
      </span>
      {text}
    </p>
  );
}
