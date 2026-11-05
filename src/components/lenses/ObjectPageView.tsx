"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { describeError, useGraph, useObject } from "@/client/hooks";
import { DataSourceError } from "@/client/data-source";
import { resolveMemoryContext } from "@/domain/context-color";
import { memoryProvenance } from "@/domain/memory";
import { deriveFacts } from "@/domain/object-facts";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import { Breadcrumb } from "../shell/Breadcrumb";
import { ALL_NAV, hrefKeepingState } from "../shell/nav";
import { ObjectActions } from "../shell/ObjectActions";
import { ProjectPage } from "../project/ProjectPage";
import { ObjectView } from "../shell/ObjectView";
import { ErrorState, LoadingState } from "../ui/states";

/** "One object, one page": the same renderer as the peek panel, at page size. */
export function ObjectPageView({ id }: { id: string }) {
  const { t } = useI18n();
  const object = useObject(id);
  const graph = useGraph();
  const params = useSearchParams();
  const [, setPeek] = usePeek();
  const facts = useMemo(
    () => (graph.data ? deriveFacts(id, graph.data.nodes, graph.data.edges) : null),
    [graph.data, id],
  );
  const memoryContext = useMemo(
    () => (graph.data ? resolveMemoryContext(id, graph.data.nodes, graph.data.edges) : null),
    [graph.data, id],
  );
  const memProvenance = useMemo(
    () => (graph.data ? memoryProvenance(id, graph.data.nodes, graph.data.edges) : null),
    [graph.data, id],
  );

  const type = object.data?.type;
  const collection = type ? ALL_NAV.find((n) => n.collection === type) : undefined;
  const back = (
    <Breadcrumb
      crumbs={[
        { label: t("nav.overview"), href: hrefKeepingState("/", params) },
        ...(collection
          ? [{ label: t(collection.label), href: hrefKeepingState(collection.href, params) }]
          : []),
        { label: object.data?.title ?? t("nav.object") },
      ]}
    />
  );

  if (object.isPending) {
    return (
      <div>
        {back}
        <LoadingState label={t("peek.loading")} lines={5} />
      </div>
    );
  }
  if (object.isError) {
    const notFound = object.error instanceof DataSourceError && object.error.status === 404;
    const described = notFound
      ? { title: t("error.notFound"), message: t("error.objectMissing") }
      : describeError(object.error, t);
    return (
      <div>
        {back}
        <ErrorState {...described} onRetry={notFound ? undefined : () => void object.refetch()} />
      </div>
    );
  }

  if (object.data.type === "project" && graph.data) {
    return (
      <div>
        {back}
        <ProjectPage
          project={object.data}
          nodes={graph.data.nodes}
          edges={graph.data.edges}
          actions={<ObjectActions object={object.data} />}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto -my-4 max-w-[1100px] px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      {back}
      <div className="rounded-[24px] border border-border bg-surface p-5 shadow-card md:p-8">
        <ObjectView
          object={object.data}
          facts={facts}
          memoryContext={memoryContext}
          memoryProvenance={memProvenance}
          variant="page"
          actions={<ObjectActions object={object.data} />}
          onPeek={setPeek}
          hrefFor={(target) => hrefKeepingState(`/objects/${target}`, params)}
        />
      </div>
    </div>
  );
}
