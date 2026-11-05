"use client";

import { useSearchParams } from "next/navigation";
import { describeError, useGraph } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { projectCards } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { ObjectActions } from "../shell/ObjectActions";
import { useUi } from "../shell/ui-store";
import { ProjectPage } from "../project/ProjectPage";
import { Icon } from "../ui/Icon";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

/**
 * "Projects", as in the design: not a list but the project itself, with the row of all projects
 * on top to switch between them (`?p=` remembers which). The app's own actions on the project
 * (add, edit, delete) sit behind the discreet menu of its header.
 */
export function ProjectsLens() {
  const { t } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const params = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);

  if (graph.isPending) return <LoadingState label={t("proj.cards")} lines={4} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }
  const { nodes, edges } = graph.data;
  const cards = projectCards(nodes, edges, today);
  const wanted = params.get("p");
  const current = cards.find((c) => c.id === wanted) ?? cards[0];
  const project = current ? nodes.find((n) => n.id === current.id) : undefined;

  if (!project)
    return (
      <EmptyState
        title={t("proj.empty")}
        description={t("cc.emptyBody")}
        action={
          <button
            type="button"
            onClick={() => openCreate({ type: "project" })}
            className="inline-flex h-10 items-center gap-2 rounded-control border border-fg bg-fg px-4 text-bg"
          >
            <Icon name="plus" />
            {t("proj.new")}
          </button>
        }
      />
    );

  return (
    <ProjectPage
      key={project.id}
      project={project}
      nodes={nodes}
      edges={edges}
      actions={<ObjectActions object={project} />}
    />
  );
}
