"use client";

import { describeError, useCommandCenter, useGraph, useSettings } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { useScenario } from "@/lib/url-state";
import { useUi } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { HomeScreen } from "./HomeScreen";

const PRIMARY =
  "inline-flex h-10 items-center gap-2 rounded-control border border-fg bg-fg px-4 text-bg transition-colors duration-(--duration-hover) hover:border-fg-muted hover:bg-fg-muted";
const SECONDARY =
  "inline-flex h-10 items-center gap-2 rounded-control border border-border px-4 transition-colors duration-(--duration-hover) hover:bg-hover";

function Skeleton() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 p-6 md:gap-6" aria-busy="true">
      <div className="rounded-card border border-border bg-surface p-6">
        <LoadingState label={t("cc.loadingCapital")} lines={3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-6">
          <LoadingState label={t("cc.loadingFocus")} />
        </div>
        <div className="rounded-card border border-border bg-surface p-6">
          <LoadingState label={t("cc.loadingNext")} />
        </div>
      </div>
    </div>
  );
}

/**
 * Home. An empty workspace is an invitation to start (the checklist); otherwise it is the
 * designed Home screen, computed from the shared graph and the progress journal.
 */
export function CommandCenter() {
  const { t } = useI18n();
  const openCreate = useUi((s) => s.openCreate);
  const settings = useSettings();
  const [scenario] = useScenario(settings.data?.activeScenario ?? "base");
  const cc = useCommandCenter(scenario);
  const graph = useGraph();

  if (cc.state === "loading") return <Skeleton />;
  if (cc.state === "error" || !cc.model) {
    const { title, message } = describeError(cc.error, t);
    return <ErrorState title={title} message={message} onRetry={cc.refetch} />;
  }
  const m = cc.model;

  if (m.isEmpty) {
    return (
      <EmptyState
        title={t("cc.emptyTitle")}
        description={t("cc.emptyBody")}
        checklist={m.checklist.map((c) => ({ label: t(`cc.check.${c.id}`), done: c.done }))}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openCreate({ type: "project" })}
              className={PRIMARY}
            >
              <Icon name="plus" />
              {t("cc.emptyCreate")}
            </button>
            <button type="button" onClick={() => openCreate({})} className={SECONDARY}>
              {t("cc.emptyExplore")}
            </button>
          </div>
        }
      />
    );
  }

  return (
    <HomeScreen
      nodes={graph.data?.nodes ?? []}
      edges={graph.data?.edges ?? []}
      today={cc.today as string}
    />
  );
}
