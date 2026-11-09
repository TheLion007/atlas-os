"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { describeWriteError, useGraph, useProgress, useRemoveExamples } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { isExample } from "@/domain/creation";
import { Mascot } from "@/design/Mascot";
import { PAIR_SWATCH } from "@/design/palette";
import { LOCALES, LOCALE_NAME } from "@/i18n/core";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { SOUND_KINDS, usePrefs, type MascotKind, type ThemeChoice } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import {
  desktopBridge,
  type AtlasUpdates,
  type DesktopInfo,
  type UpdateState,
} from "@/lib/desktop";
import { useUpdates } from "@/lib/use-updates";
import type { MessageKey } from "@/i18n";
import { useMediaQuery } from "@/lib/use-media-query";
import pkg from "../../../package.json";
import { useOllamaStore } from "@/lib/ollama-store";
import { Row, Toggle } from "./settings-parts";
import { MyDataCard } from "./MyDataCard";
import { useOllama } from "../ai/use-ollama";
import { ConfirmDialog } from "../create/ConfirmDialog";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";

const DEMO_KEY = "atlas.demo.workspace.v1";
const REPO = "https://github.com/TheLion007/atlas-os";

const SECTIONS = [
  ["appearance", "st.nav.appearance"],
  ["sounds", "st.nav.sounds"],
  ["motion", "st.nav.motion"],
  ["mascot", "st.nav.mascot"],
  ["ai", "st.nav.ai"],
  ["shortcuts", "st.nav.shortcuts"],
  ["backup", "st.nav.backup"],
  ["data", "st.nav.data"],
  ["feedback", "st.nav.feedback"],
  ["advanced", "st.nav.advanced"],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

const THEMES: readonly ThemeChoice[] = ["light", "dark", "system"];
const PAIRS = ["indigo", "teal", "violet"] as const;
const PROFILES = ["soft", "normal", "crystal"] as const;
const MASCOTS: readonly MascotKind[] = ["pip", "moka", "fil"];

const OTHER = [
  ["/timeline", "nav.timeline"],
  ["/memory", "nav.memory"],
  ["/plans", "nav.plans"],
  ["/tasks", "nav.tasks"],
  ["/finance", "nav.finance"],
  ["/decisions", "nav.decisions"],
  ["/risks", "nav.risks"],
] as const;

function Card({
  id,
  title,
  sub,
  action,
  children,
}: {
  id: SectionId;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`st-${id}`}
      data-section={id}
      aria-labelledby={`st-${id}-t`}
      className="flex scroll-mt-5 flex-col gap-4 rounded-[24px] border border-border bg-surface p-[22px] shadow-card"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`st-${id}-t`} className="font-display text-[19px] leading-none font-bold">
            {title}
          </h2>
          {sub && <p className="text-[12.5px] text-fg-subtle">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Updates, in the desktop app only: the automatic check, the version, the state and what to do. */
function UpdateRows({
  state,
  api,
  plain,
}: {
  state: UpdateState;
  api: AtlasUpdates;
  plain: string;
}) {
  const { t } = useI18n();
  const params = { latest: state.latest ?? "", current: state.current, percent: state.percent };
  const busy = state.status === "checking" || state.status === "downloading";
  const text = state.error
    ? t(`up.err.${state.error}` as MessageKey)
    : t(`up.status.${state.status}` as MessageKey, params);
  return (
    <>
      <Row title={t("up.autoTitle")} sub={t("up.autoSub")}>
        <Toggle on={state.auto} onChange={(on) => void api.setAuto(on)} label={t("up.autoTitle")} />
      </Row>
      <Row title={t("up.version", params)} sub={text}>
        {state.status === "available" ? (
          <button type="button" className={plain} onClick={() => void api.download()}>
            {t("up.download")}
          </button>
        ) : state.status === "ready" ? (
          <button type="button" className={plain} onClick={() => void api.install()}>
            {t("up.install")}
          </button>
        ) : (
          <button type="button" className={plain} disabled={busy} onClick={() => void api.check()}>
            {state.status === "checking" ? t("up.checking") : t("up.checkNow")}
          </button>
        )}
      </Row>
    </>
  );
}

const key =
  "num rounded-[6px] bg-sunk px-[7px] py-[3px] text-[10.5px] text-fg-muted whitespace-nowrap";

/**
 * Settings, as in the design: a sticky list of sections on the left, one card per section on the
 * right. Every switch applies at once. The app's own preferences that the design does not draw
 * (colour pair, sound profile, language, example data, the other screens) sit in the cards where
 * they belong, or in the last one.
 */
export function SettingsLens() {
  const { t, locale, setLocale } = useI18n();
  const prefs = usePrefs();
  const systemReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const params = useSearchParams();
  const graph = useGraph();
  const progress = useProgress(3650);
  const source = useSource();
  const removeExamples = useRemoveExamples();
  const ollama = useOllama(false);
  const setAiModel = useOllamaStore((st) => st.setModel);
  const openTutorial = useOllamaStore((st) => st.openTutorial);
  const setAssistantOpen = useUi((st) => st.setAssistantOpen);
  const pushToast = useUi((s) => s.pushToast);
  const [active, setActive] = useState<SectionId>("appearance");
  // Only in the desktop app: where the data lives on this PC.
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    let live = true;
    void desktopBridge()
      ?.getInfo()
      .then((info) => live && setDesktop(info));
    return () => {
      live = false;
    };
  }, []);
  const updates = useUpdates();
  const desktopData = !!desktop && !!desktopBridge()?.data;
  const [confirm, setConfirm] = useState<"remove" | "restore" | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // The list follows the section you are reading.
  useEffect(() => {
    const els = [...(root.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [])];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive((top.target as HTMLElement).dataset.section as SectionId);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const nodes = graph.data?.nodes ?? [];
  const examples = nodes.filter(isExample).length;
  const own = nodes.length - examples;
  const demo = source?.mode === "fixtures";

  const go = (id: SectionId) => {
    playSound("click");
    setActive(id);
    document.getElementById(`st-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportBackup = () => {
    try {
      const data = {
        app: "atlas-os",
        version: pkg.version,
        exportedAt: new Date().toISOString(),
        nodes: graph.data?.nodes ?? [],
        edges: graph.data?.edges ?? [],
        progress: progress.data ?? [],
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `atlas-os-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      playSound("create");
      pushToast(t("st.backupExported", { count: data.nodes.length }));
    } catch {
      playSound("error");
      pushToast(t("st.backupFailed"));
    }
  };

  const remove = async () => {
    try {
      await removeExamples.mutateAsync();
      pushToast(t("settings.examplesRemoved"));
      setConfirm(null);
    } catch (e) {
      pushToast(describeWriteError(e, t));
    }
  };
  const restore = () => {
    try {
      window.localStorage.removeItem(DEMO_KEY);
    } catch {
      /* storage blocked: reloading still restarts from the examples */
    }
    window.location.reload();
  };

  const plain =
    "rounded-[10px] border border-border-strong bg-surface px-3 py-[5px] text-[12px] font-medium transition-[background-color,transform] hover:bg-sunk active:scale-[0.96]";
  const chip = (on: boolean) =>
    cn(
      "rounded-[12px] border px-4 py-2 text-[13px] font-medium transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px",
      on ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-sunk",
    );
  const swatch = PAIR_SWATCH[prefs.pair];

  return (
    <div
      ref={root}
      className="mx-auto -my-4 flex max-w-[1100px] flex-wrap items-start gap-[30px] px-4 pt-[26px] pb-20 md:-my-6 md:px-8"
    >
      <nav
        aria-label={t("settings.title")}
        className="sticky top-5 flex w-full flex-none flex-col gap-[2px] md:w-[190px]"
      >
        <h1 className="mb-[14px] ml-[10px] font-display text-[28px] font-extrabold tracking-[-0.03em]">
          {t("settings.title")}
        </h1>
        {SECTIONS.filter(([id]) => id !== "data" || desktopData).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={active === id ? "true" : undefined}
            onClick={() => go(id)}
            className={cn(
              "rounded-[10px] px-[10px] py-2 text-left text-[13.5px] font-semibold transition-colors duration-200",
              active === id ? "bg-surface text-fg shadow-card" : "text-fg-subtle hover:text-fg",
            )}
          >
            {t(label)}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-[22px]">
        <Card id="appearance" title={t("st.appearance")} sub={t("st.appearanceSub")}>
          <div
            role="radiogroup"
            aria-label={t("st.appearance")}
            className="grid gap-3 sm:grid-cols-3"
          >
            {THEMES.map((id) => {
              const dark = id === "dark";
              const bg = dark ? swatch.dark[0] : swatch.light[0];
              const card = dark ? swatch.dark[1] : swatch.light[1];
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.theme === id}
                  onClick={() => prefs.set({ theme: id })}
                  className={cn(
                    "flex flex-col gap-2 rounded-[16px] border-2 p-2 text-left transition-[border-color,transform] duration-200 hover:-translate-y-px",
                    prefs.theme === id ? "border-accent" : "border-border",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="relative flex h-[84px] overflow-hidden rounded-[10px]"
                    style={{ background: id === "system" ? swatch.light[0] : bg }}
                  >
                    {id === "system" && (
                      <span
                        className="absolute inset-y-0 right-0 w-1/2"
                        style={{
                          background: swatch.dark[0],
                          clipPath: "polygon(30% 0, 100% 0, 100% 100%, 0 100%)",
                        }}
                      />
                    )}
                    <span
                      className="absolute right-2 bottom-2 left-8 h-[50px] rounded-[7px]"
                      style={{ background: id === "system" ? swatch.light[1] : card }}
                    />
                    <span
                      className="absolute bottom-4 left-11 h-[5px] w-10 rounded-full"
                      style={{ background: swatch.accent }}
                    />
                  </span>
                  <span className="flex items-center justify-between px-1 pb-1 text-[13px] font-semibold">
                    {t(`feel.theme.${id}`)}
                    {prefs.theme === id && (
                      <span className="text-[11px] text-accent-ink">{t("st.active")}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <Row title={t("st.palette")} sub={t("st.paletteSub")}>
            <div role="radiogroup" aria-label={t("st.palette")} className="flex flex-wrap gap-2">
              {PAIRS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.pair === id}
                  onClick={() => prefs.set({ pair: id })}
                  className={cn(chip(prefs.pair === id), "flex items-center gap-2")}
                >
                  <i
                    className="size-3 rounded-full"
                    style={{ background: PAIR_SWATCH[id].accent }}
                    aria-hidden="true"
                  />
                  {t(`feel.pair.${id}`)}
                </button>
              ))}
            </div>
          </Row>
        </Card>

        <Card
          id="sounds"
          title={t("st.sounds")}
          sub={t("st.soundsSub")}
          action={
            <Toggle
              on={prefs.soundOn}
              label={t("st.sounds")}
              onChange={(on) => {
                prefs.set({ soundOn: on });
                if (on) window.setTimeout(() => playSound("check", true), 0);
              }}
            />
          }
        >
          <label className="flex items-center gap-4 rounded-[12px] bg-sunk px-4 py-3">
            <span className="text-[13px] font-semibold">{t("st.volume")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={prefs.volume}
              disabled={!prefs.soundOn}
              onChange={(e) => prefs.set({ volume: Number(e.target.value) })}
              onPointerUp={() => playSound("check", true)}
              className="h-2 grow accent-accent disabled:opacity-50"
            />
            <span className="num w-10 text-right text-[12px] text-fg-muted">{prefs.volume} %</span>
          </label>
          <Row title={t("st.profile")}>
            <div role="radiogroup" aria-label={t("st.profile")} className="flex flex-wrap gap-2">
              {PROFILES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.soundProfile === id}
                  data-sound="none"
                  onClick={() => {
                    prefs.set({ soundProfile: id });
                    window.setTimeout(() => playSound("check", true), 0);
                  }}
                  className={chip(prefs.soundProfile === id)}
                >
                  {t(`feel.profile.${id}`)}
                </button>
              ))}
            </div>
          </Row>
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {SOUND_KINDS.map((kind) => (
              <li
                key={kind}
                className="flex items-center justify-between gap-3 border-t border-border py-[10px]"
              >
                <span className="text-[13px]">{t(`feel.sound.${kind}`)}</span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    data-sound="none"
                    onClick={() => playSound(kind, true)}
                    className={plain}
                  >
                    {t("st.test")}
                  </button>
                  <Toggle
                    on={prefs.sounds[kind]}
                    label={t(`feel.sound.${kind}`)}
                    quiet
                    onChange={(on) => prefs.setSound(kind, on)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card id="motion" title={t("st.motion")}>
          <div>
            <Row title={t("st.motionAll")} sub={t("st.motionAllSub")}>
              <Toggle
                on={prefs.motion}
                label={t("st.motionAll")}
                onChange={(on) => prefs.set({ motion: on })}
              />
            </Row>
            <Row title={t("st.celebrations")} sub={t("st.celebrationsSub")}>
              <Toggle
                on={prefs.celebrations}
                label={t("st.celebrations")}
                onChange={(on) => prefs.set({ celebrations: on })}
              />
            </Row>
            <Row title={t("st.tracks")} sub={t("st.tracksSub")}>
              <Toggle
                on={prefs.mascotTracks}
                label={t("st.tracks")}
                onChange={(on) => prefs.set({ mascotTracks: on })}
              />
            </Row>
          </div>
          <p className="rounded-[10px] bg-sunk px-4 py-2 text-[12px] text-fg-muted">
            {systemReduced ? t("st.motionSystem") : t("st.motionFree")}
          </p>
        </Card>

        <Card
          id="mascot"
          title={t("st.mascot")}
          sub={t("st.mascotSub")}
          action={
            <Toggle
              on={prefs.mascotOn}
              label={t("st.mascotShow")}
              onChange={(on) => prefs.set({ mascotOn: on })}
            />
          }
        >
          <div role="radiogroup" aria-label={t("st.mascot")} className="grid gap-3 sm:grid-cols-3">
            {MASCOTS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={prefs.mascot === id}
                onClick={() => {
                  prefs.set({ mascot: id });
                  playSound("create");
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-[18px] border-2 bg-panel p-4 text-center transition-[border-color,transform] duration-200 hover:-translate-y-[2px]",
                  prefs.mascot === id ? "border-accent" : "border-border",
                )}
              >
                <Mascot kind={id} size={64} track={prefs.mascotTracks} />
                <span className="font-display text-[19px] font-bold">{t(`feel.mascot.${id}`)}</span>
                <span className="text-[12px] leading-[1.4] text-fg-subtle">{t(`st.${id}`)}</span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-[11.5px] font-semibold",
                    prefs.mascot === id ? "bg-accent text-on-accent" : "bg-sunk text-fg-muted",
                  )}
                >
                  {prefs.mascot === id ? t("st.chosen") : t("st.choose")}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card id="ai" title={t("st.ai")} sub={t("st.aiSub")}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-sunk px-4 py-3 text-[13px]">
            <span className="flex items-center gap-2" role="status">
              <i
                aria-hidden="true"
                className={cn(
                  "size-[9px] rounded-full",
                  ollama.state === "ready"
                    ? "bg-positive"
                    : ollama.state === "no-model"
                      ? "bg-warn"
                      : "bg-fg-subtle",
                )}
              />
              {ollama.pending
                ? t("ai.checking")
                : ollama.state === "ready"
                  ? t("st.ai.on", { count: ollama.status?.models.length ?? 0 })
                  : ollama.state === "no-model"
                    ? t("st.ai.noModel")
                    : t("st.ai.off")}
            </span>
            <button
              type="button"
              disabled={ollama.checking}
              onClick={() => {
                playSound("click");
                void ollama
                  .check()
                  .then((found) =>
                    playSound(found.reachable && found.models.length > 0 ? "create" : "error"),
                  );
              }}
              className={plain}
            >
              {ollama.checking ? t("ai.testing") : t("ai.test")}
            </button>
          </div>
          <Row title={t("st.ai.model")} sub={t("ai.slow")}>
            <select
              aria-label={t("st.ai.model")}
              disabled={!ollama.status || ollama.status.models.length === 0}
              value={ollama.model ?? ""}
              onChange={(e) => {
                playSound("click");
                setAiModel(e.target.value);
                pushToast(t("st.ai.chosen", { model: e.target.value }));
              }}
              className="h-9 max-w-[220px] rounded-[11px] border border-border-strong bg-surface px-2 text-[13px] disabled:opacity-60"
            >
              {(ollama.status?.models.length ?? 0) === 0 && (
                <option value="">{t("st.ai.noModels")}</option>
              )}
              {ollama.status?.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.sizeBytes > 0
                    ? ` · ${t("ai.gb", { gb: (m.sizeBytes / 1e9).toFixed(1) })}`
                    : ""}
                </option>
              ))}
            </select>
          </Row>
          <div>
            <button
              type="button"
              onClick={() => {
                playSound("click");
                openTutorial();
                setAssistantOpen(true);
              }}
              className={plain}
            >
              {t("st.ai.reopen")}
            </button>
          </div>
        </Card>

        <Card id="shortcuts" title={t("st.shortcuts")}>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {(
              [
                ["st.k.palette", "Ctrl K"],
                ["st.k.assistant", "Ctrl J"],
                ["st.k.screens", "1 – 0"],
                ["st.k.task", "N"],
                ["st.k.timer", "T"],
                ["st.k.project", "P"],
                ["st.k.note", "Q"],
                ["st.k.theme", "D"],
                ["st.k.organize", "Ctrl ↵"],
                ["st.k.delete", t("rm.menu.key")],
                ["st.k.undoDelete", "Ctrl Z"],
                ["st.k.close", "Esc"],
              ] as const
            ).map(([label, k]) => (
              <li
                key={label}
                className="flex items-center justify-between gap-3 py-[7px] text-[13px]"
              >
                <span>{t(label)}</span>
                <span className={key}>{k}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card id="backup" title={t("st.backup")} sub={t("st.backupSub")}>
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-sunk px-4 py-3 text-[13px]">
            <span className="text-fg-muted">{t("st.backupWhere")}</span>
            <span className="text-right">
              {demo ? t("settings.sourceDemo") : t("settings.sourceApi")}
            </span>
          </div>
          {desktop && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-sunk px-4 py-3 text-[13px]">
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-fg-muted">{t("st.dataFolder")}</span>
                <span className="num break-all select-all">{desktop.dataDir}</span>
              </span>
              <button
                type="button"
                className={plain}
                onClick={() => {
                  playSound("click");
                  void desktopBridge()?.openDataFolder();
                }}
              >
                {t("st.openFolder")}
              </button>
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={exportBackup}
              disabled={!graph.data}
              className="h-10 rounded-[12px] bg-fg px-4 text-[13px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96] disabled:opacity-60"
            >
              {t("st.backupExport")}
            </button>
          </div>
        </Card>

        {desktopData && (
          <Card id="data" title={t("md.title")} sub={t("md.sub")}>
            <MyDataCard />
          </Card>
        )}

        <Card id="feedback" title={t("st.feedback")} sub={t("st.feedbackSub")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["st.report", "st.reportSub", `${REPO}/issues/new`],
                ["st.suggest", "st.suggestSub", `${REPO}/issues/new`],
              ] as const
            ).map(([title, sub, href]) => (
              <a
                key={title}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-1 rounded-[14px] border border-border-strong bg-panel px-4 py-3 transition-[transform,background-color] duration-300 ease-(--ease-spring) hover:-translate-y-[2px] hover:bg-sunk"
              >
                <span className="text-[13.5px] font-semibold">{t(title)}</span>
                <span className="text-[12px] text-fg-subtle">{t(sub)}</span>
              </a>
            ))}
          </div>
          <p className="border-t border-border pt-3 text-[12px] text-fg-subtle">
            {t("st.version", { version: pkg.version })}
          </p>
        </Card>

        <Card id="advanced" title={t("st.advanced")}>
          <Row title={t("settings.language")} sub={t("settings.languageBody")}>
            <div role="radiogroup" aria-label={t("settings.language")} className="flex gap-2">
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={locale === l}
                  onClick={() => setLocale(l)}
                  className={chip(locale === l)}
                >
                  <span lang={l}>{LOCALE_NAME[l]}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row
            title={t("settings.examples")}
            sub={
              (examples > 0
                ? t("settings.examplesCount", { count: examples })
                : t("settings.examplesNone")) +
              " · " +
              t("settings.yourObjects", { count: own })
            }
          >
            <span className="flex flex-wrap gap-2">
              {examples > 0 && (
                <button type="button" className={plain} onClick={() => setConfirm("remove")}>
                  {t("settings.examplesRemove")}
                </button>
              )}
              {demo && (
                <button type="button" className={plain} onClick={() => setConfirm("restore")}>
                  {t("settings.demoReset")}
                </button>
              )}
            </span>
          </Row>
          {updates.state && updates.api && (
            <UpdateRows state={updates.state} api={updates.api} plain={plain} />
          )}
          <div>
            <p className="mb-2 text-[13.5px] font-semibold">{t("other.title")}</p>
            <ul className="flex flex-wrap gap-2">
              {OTHER.map(([href, label]) => (
                <li key={href}>
                  <Link href={hrefKeepingState(href, params)} className={cn(plain, "inline-flex")}>
                    {t(label)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("settings.examplesRemove")}
        body={t("settings.examplesConfirm", { count: examples })}
        confirmLabel={t("delete.confirm")}
        onConfirm={() => void remove()}
        busy={removeExamples.isPending}
      />
      <ConfirmDialog
        open={confirm === "restore"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("settings.demoReset")}
        body={t("settings.demoResetConfirm")}
        confirmLabel={t("settings.demoReset")}
        onConfirm={restore}
      />
    </div>
  );
}
