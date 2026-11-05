"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useGraph, useSettings } from "@/client/hooks";
import { CreateDialog } from "../create/CreateDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { useScenario, usePeek } from "@/lib/url-state";
import { AssistantSheet } from "./AIThread";
import { AssistantPanel } from "./AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { hrefKeepingState } from "./nav";
import { buildPaletteItems } from "./palette-items";
import { PeekHost } from "./PeekPanel";
import { Sidebar } from "./Sidebar";
import { usePrefs } from "@/lib/feedback/prefs";
import { ARTIFACT_NAV } from "./artifact-nav";
import { AiEngine } from "../ai/use-ollama";
import { TimerEngine, useTimerToggle } from "../timer/use-timer";
import { FeedbackLayer } from "./FeedbackLayer";
import { Toaster } from "./Toaster";
import { DeleteBanner, DeleteHost } from "./DeleteHost";
import { UpdateNotice } from "./UpdateNotice";
import { TopBar } from "./TopBar";
import { useUi } from "./ui-store";

/** ⌘K / Ctrl+K opens the palette and ⌘J / Ctrl+J the assistant, from anywhere. */
function useGlobalShortcuts() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const setAssistantOpen = useUi((s) => s.setAssistantOpen);
  const openCreate = useUi((s) => s.openCreate);
  const router = useRouter();
  const timerToggle = useTimerToggle();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The design's single keys: 1–0 change screen, P / N / Q create, D flips the theme. They
      // never fire while you are typing, or with a modifier held.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const el = e.target as HTMLElement | null;
        const typing =
          !!el &&
          (el.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
            !!el.closest("[role=dialog]"));
        if (!typing) {
          const k = e.key.toLowerCase();
          const place = ARTIFACT_NAV.find((n) => n.key === k);
          if (place) router.push(place.href);
          else if (k === "p") openCreate({ type: "project" });
          else if (k === "n") openCreate({ type: "task" });
          else if (k === "q") openCreate({ type: "note" });
          else if (k === "t") timerToggle();
          else if (k === "d") {
            const prefs = usePrefs.getState();
            prefs.set({
              theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
            });
          } else return;
          e.preventDefault();
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setPaletteOpen(!useUi.getState().paletteOpen);
      } else if (key === "j") {
        e.preventDefault();
        setAssistantOpen(!useUi.getState().assistantOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, setAssistantOpen, openCreate, router, timerToggle]);
}

function PaletteHost() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const recent = useUi((s) => s.recent);
  const sidebar = useUi((s) => s.sidebar);
  const setSidebar = useUi((s) => s.setSidebar);
  const setAssistantOpen = useUi((s) => s.setAssistantOpen);
  const openCreate = useUi((s) => s.openCreate);
  const { t, locale, setLocale } = useI18n();
  const graph = useGraph();
  const settings = useSettings();
  const router = useRouter();
  const toggleTimer = useTimerToggle();
  const params = useSearchParams();
  const [scenario, setScenario] = useScenario(settings.data?.activeScenario ?? "base");
  const [peekId, setPeek] = usePeek();
  const context = useMemo(
    () => graph.data?.nodes.find((n) => n.id === peekId) ?? null,
    [graph.data, peekId],
  );
  const [query, setQuery] = useState("");

  const items = useMemo(
    () =>
      buildPaletteItems({
        query,
        nodes: graph.data?.nodes ?? [],
        recent,
        scenario,
        locale,
        t,
        context,
        actions: {
          peek: (id) => setPeek(id),
          open: (id) => router.push(hrefKeepingState(`/objects/${id}`, params)),
          go: (href) => router.push(hrefKeepingState(href, params)),
          setScenario,
          toggleSidebar: () => setSidebar(sidebar === "collapsed" ? "expanded" : "collapsed"),
          openAssistant: () => setAssistantOpen(true),
          toggleTimer,
          toggleTheme: () => {
            const prefs = usePrefs.getState();
            const dark = document.documentElement.dataset.theme === "dark";
            prefs.set({ theme: dark ? "light" : "dark" });
          },
          create: (type, parent) =>
            openCreate({
              type,
              parent: parent ? { id: parent.id, type: parent.type, title: parent.title } : null,
            }),
          setLocale,
        },
      }),
    [
      toggleTimer,
      query,
      graph.data,
      recent,
      scenario,
      setPeek,
      router,
      params,
      setScenario,
      setSidebar,
      sidebar,
      setAssistantOpen,
      openCreate,
      locale,
      t,
      context,
      setLocale,
    ],
  );

  return (
    <CommandPalette
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      query={query}
      onQueryChange={setQuery}
      items={items}
      loading={graph.isPending}
    />
  );
}

function AssistantHost() {
  const open = useUi((s) => s.assistantOpen);
  const setOpen = useUi((s) => s.setAssistantOpen);
  return (
    <AssistantSheet open={open} onOpenChange={setOpen}>
      <AssistantPanel />
    </AssistantSheet>
  );
}

function MobileNav() {
  const open = useUi((s) => s.navOpen);
  const setOpen = useUi((s) => s.setNavOpen);
  const { t } = useI18n();
  const pathname = usePathname();
  // Close after navigating.
  useEffect(() => setOpen(false), [pathname, setOpen]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-bg/80 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet-left fixed inset-y-0 left-0 z-50 max-w-full md:hidden focus:outline-none"
        >
          <Dialog.Title className="sr-only">{t("nav.navigation")}</Dialog.Title>
          <Sidebar variant="drawer" onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The application shell (blueprint slide 13): a 248px sidebar, a 56px top bar with the scenario
 * switch and search, the content region, and an optional 440px peek panel. Everything ambient
 * (palette, assistant, peek) overlays the lens, so context is never lost.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  useGlobalShortcuts();
  // Persisted preferences are read after mount so the first client render matches the server's.
  useEffect(() => {
    void useUi.persist.rehydrate();
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:border focus:border-border focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("nav.skip")}
      </a>
      <Sidebar />
      <div className="flex min-w-0 grow flex-col">
        <TopBar />
        <div className="flex min-h-0 grow">
          <main
            id="main"
            tabIndex={-1}
            className="min-w-0 grow overflow-y-auto p-4 focus:outline-none md:p-6"
          >
            <div key={pathname} className="screen-in min-h-full">
              {children}
            </div>
          </main>
          {!/^\/(map|graph|documents)(\/|$)/.test(pathname) && <PeekHost />}
        </div>
      </div>
      <MobileNav />
      <PaletteHost />
      <AssistantHost />
      <CreateDialog />
      <Toaster />
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[79] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-[10px] md:bottom-6">
        <DeleteBanner />
        <UpdateNotice />
      </div>
      <DeleteHost />
      <FeedbackLayer />
      <TimerEngine />
      <AiEngine />
    </div>
  );
}
