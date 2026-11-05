"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { describeError, describeWriteError, useGraph, useUpdateObject } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import type { MapHandle } from "../canvases/MapCanvas";
import { buildMapModel, placeOf } from "../canvases/map-model";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { Icon, type IconName } from "../ui/Icon";
import { ErrorState, LoadingState } from "../ui/states";
import { MapPanel } from "./MapPanel";
import { MapViewSwitch, type MapView } from "./MapViewSwitch";
import { TerritoryMap } from "./TerritoryMap";

// The globe (MapLibre and the geography) is a heavy, browser-only chunk: it loads on this route.
const MapCanvas = dynamic(() => import("../canvases/MapCanvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg" />,
});

const FlatMapCanvas = dynamic(
  () => import("../canvases/FlatMapCanvas").then((m) => m.FlatMapCanvas),
  { ssr: false, loading: () => <div className="h-full w-full bg-bg" /> },
);

const control =
  "inline-flex size-8 items-center justify-center text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg";

function ControlButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={control} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/**
 * The Map lens: a real globe, from Earth down to an address, driven by the user's own
 * locations. The selected place lives in the URL (`?peek=`), so it survives lens switches and
 * a link reproduces the view. Selecting anything located (a place, or a project or property at
 * one) flies the camera there. The panel beside it is the text equivalent and the way down the
 * place hierarchy.
 */
export function MapLens() {
  const { t } = useI18n();
  const graph = useGraph();
  const params = useSearchParams();
  const [peekId, setPeek] = usePeek();
  const openCreate = useUi((s) => s.openCreate);
  const pushToast = useUi((s) => s.pushToast);
  const update = useUpdateObject();
  const handle = useRef<MapHandle | null>(null);
  // Placing something on the globe: a new location (`{}`), or one that has no coordinates yet.
  const [pick, setPick] = useState<{ forId?: string } | null>(null);
  const [rotationPaused, setRotationPaused] = useState(false);
  // The same places on a 3D globe or a flat world map.
  const [view, setView] = useState<MapView>("territory");
  const flat = view === "flat";

  const model = useMemo(
    () => (graph.data ? buildMapModel(graph.data.nodes, graph.data.edges) : null),
    [graph.data],
  );

  // One source of truth: the peeked object. A place selects itself; anything located selects
  // the place it is at.
  const selectedPlaceId = useMemo(() => {
    if (!model || !peekId) return null;
    if (model.places.has(peekId)) return peekId;
    return placeOf(model, peekId)?.id ?? null;
  }, [model, peekId]);

  if (graph.isPending || !model) {
    return graph.isError ? null : <LoadingState label={t("map.loading")} lines={4} />;
  }
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const hrefFor = (id: string) => hrefKeepingState(`/objects/${id}`, params);

  const onPick = (coords: { lat: number; lng: number }) => {
    const target = pick;
    setPick(null);
    if (target?.forId) {
      const place = model.places.get(target.forId);
      update.mutate(
        {
          id: target.forId,
          patch: {
            details: {
              lat: Math.round(coords.lat * 1e6) / 1e6,
              lng: Math.round(coords.lng * 1e6) / 1e6,
              coordinatesSource: "manual",
            },
          },
        },
        {
          onSuccess: () => {
            pushToast(t("map.placed", { name: place?.title ?? "" }));
            setPeek(target.forId ?? null);
          },
          onError: (e) => pushToast(describeWriteError(e, t)),
        },
      );
      return;
    }
    // A new place: the dialog opens with the coordinates already filled in.
    const parent = selectedPlaceId ? model.places.get(selectedPlaceId) : undefined;
    openCreate({
      type: "location",
      coords,
      parent: parent ? { id: parent.id, type: "location", title: parent.title } : null,
    });
  };

  const pickingFor = pick?.forId ? model.places.get(pick.forId)?.title : undefined;

  if (view === "territory")
    return (
      <div className="relative">
        <TerritoryMap />
        <MapViewSwitch
          view={view}
          onChange={setView}
          className="absolute right-5 bottom-[22px] rounded-[10px] border border-border bg-surface p-0.5 opacity-80 hover:opacity-100"
        />
      </div>
    );

  return (
    <div className="-m-4 flex h-[calc(100dvh-var(--topbar-h))] flex-col md:-m-6 md:flex-row">
      <MapPanel
        model={model}
        selectedPlaceId={selectedPlaceId}
        peekId={peekId}
        onSelectPlace={setPeek}
        onEarth={() => {
          setPeek(null);
          handle.current?.earth();
        }}
        onPeekObject={setPeek}
        hrefFor={hrefFor}
        onAddLocation={() => setPick({})}
        onPlaceOnGlobe={(id) => setPick({ forId: id })}
        className="order-2 h-[45dvh] shrink-0 border-t md:order-1 md:h-auto md:w-80 md:border-t-0 md:border-r"
      />

      <div className="relative order-1 h-[42dvh] min-h-0 grow md:order-2 md:h-auto">
        {flat ? (
          <FlatMapCanvas
            key="flat"
            model={model}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setPeek}
            pick={pick !== null}
            onPick={onPick}
            handleRef={handle}
          />
        ) : (
          <MapCanvas
            key="globe"
            model={model}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setPeek}
            pick={pick !== null}
            onPick={onPick}
            handleRef={handle}
            paused={rotationPaused}
          />
        )}

        <div
          role="toolbar"
          aria-label={t("map.controls")}
          className="absolute top-4 right-4 flex flex-col divide-y divide-border overflow-hidden rounded-control border border-border bg-surface"
        >
          <ControlButton
            icon="plus"
            label={t("map.zoomIn")}
            onClick={() => handle.current?.zoomBy(2)}
          />
          <ControlButton
            icon="minus"
            label={t("map.zoomOut")}
            onClick={() => handle.current?.zoomBy(0.5)}
          />
          <ControlButton
            icon="globe"
            label={t("map.earth")}
            onClick={() => {
              setPeek(null);
              handle.current?.earth();
            }}
          />
          <ControlButton
            icon="fit"
            label={t("map.fitAll")}
            onClick={() => handle.current?.fitAll()}
          />
          {!flat && (
            <ControlButton
              icon={rotationPaused ? "play" : "pause"}
              label={rotationPaused ? t("map.resumeRotation") : t("map.pauseRotation")}
              onClick={() => setRotationPaused((v) => !v)}
            />
          )}
        </div>

        <MapViewSwitch
          view={view}
          onChange={setView}
          className="absolute top-4 left-4 rounded-[10px] border border-border bg-surface p-0.5"
        />

        {pick && (
          <div
            role="status"
            className="rise-in absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
          >
            <Icon name="globe" className="text-fg-muted" />
            <span>
              {pickingFor ? t("map.pickHintFor", { name: pickingFor }) : t("map.pickHint")}
            </span>
            <button
              type="button"
              onClick={() => setPick(null)}
              className="rounded-control border border-border px-2 py-1 text-xs transition-colors duration-(--duration-hover) hover:bg-hover"
            >
              {t("map.pickCancel")}
            </button>
          </div>
        )}

        <p className="label pointer-events-none absolute bottom-4 left-4 hidden rounded-control bg-bg px-2 py-1 md:block">
          {flat ? t("map.hintFlat") : t("map.hint")}
        </p>
      </div>
    </div>
  );
}
