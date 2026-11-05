"use client";

import { DeleteButton } from "../shell/DeleteButton";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { ancestry, type MapModel, type Place } from "../canvases/map-model";
import { Icon } from "../ui/Icon";
import { ObjectChip } from "../ui/ObjectChip";
import { TypeGlyph } from "../ui/TypeGlyph";

interface MapPanelProps {
  model: MapModel;
  selectedPlaceId: string | null;
  /** The object currently peeked, so its chip shows as selected. */
  peekId: string | null;
  onSelectPlace: (id: string) => void;
  onEarth: () => void;
  onPeekObject: (id: string) => void;
  hrefFor: (id: string) => string;
  onAddLocation: () => void;
  onPlaceOnGlobe: (id: string) => void;
  className?: string;
}

const row =
  "flex w-full items-center gap-3 rounded-control px-2 py-2 text-left text-sm transition-colors duration-(--duration-hover) hover:bg-hover";

/**
 * The place hierarchy next to the globe, and what is at the selected place. It is the text
 * equivalent of the map (every place is reachable here without the globe), and the way down
 * through the hierarchy: Earth, a country, a city, a district, an address.
 */
export function MapPanel({
  model,
  selectedPlaceId,
  peekId,
  onSelectPlace,
  onEarth,
  onPeekObject,
  hrefFor,
  onAddLocation,
  onPlaceOnGlobe,
  className,
}: MapPanelProps) {
  const { t, typeLabel } = useI18n();
  const selected = selectedPlaceId ? (model.places.get(selectedPlaceId) ?? null) : null;
  const chain = selected ? ancestry(model, selected.id) : [];
  // What is listed: the places inside the selected one, or the top of the hierarchy.
  const listed = (selected ? selected.childIds : model.roots)
    .map((id) => model.places.get(id))
    .filter((p): p is Place => !!p);
  const here = selected ? selected.objectIds.map((id) => model.objects.get(id)) : [];
  const unplaced = model.unplaced.map((id) => model.places.get(id) as Place);

  const placeRow = (p: Place) => (
    <li key={p.id}>
      <button type="button" className={row} onClick={() => onSelectPlace(p.id)}>
        <TypeGlyph type="location" />
        <span className="min-w-0 grow truncate">{p.title}</span>
        <span className="label shrink-0">{t(`level.${p.level}`)}</span>
        {p.objectIds.length > 0 && (
          <span className="num shrink-0 text-xs text-fg-muted">{p.objectIds.length}</span>
        )}
      </button>
    </li>
  );

  return (
    <aside
      aria-label={t("map.panel")}
      className={cn(
        "flex min-h-0 flex-col gap-6 overflow-y-auto border-border bg-bg p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="label">{t("map.panel")}</h2>
        <button
          type="button"
          onClick={onAddLocation}
          className="inline-flex h-8 items-center gap-2 rounded-control border border-border px-3 text-sm transition-colors duration-(--duration-hover) hover:bg-hover"
        >
          <Icon name="plus" />
          {t("map.addLocation")}
        </button>
      </div>

      <nav aria-label={t("map.hierarchy")}>
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          <li className="flex items-center gap-1">
            <button
              type="button"
              onClick={onEarth}
              aria-current={selected ? undefined : "location"}
              className={cn(
                "rounded-control px-2 py-1 transition-colors duration-(--duration-hover) hover:bg-hover",
                selected ? "text-fg-muted hover:text-fg" : "bg-selected text-fg",
              )}
            >
              {t("map.earthRoot")}
            </button>
          </li>
          {chain.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1">
              <Icon name="chevronRight" className="text-fg-muted" />
              <button
                type="button"
                onClick={() => onSelectPlace(p.id)}
                aria-current={i === chain.length - 1 ? "location" : undefined}
                className={cn(
                  "rounded-control px-2 py-1 transition-colors duration-(--duration-hover) hover:bg-hover",
                  i === chain.length - 1 ? "bg-selected text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {model.places.size === 0 ? (
        <p className="text-fg-muted">{t("map.noPlaces")}</p>
      ) : (
        <>
          {listed.length > 0 && (
            <section
              aria-label={selected ? t("map.inside") : t("map.top")}
              className="flex flex-col gap-2"
            >
              <h3 className="label px-2">{selected ? t("map.inside") : t("map.top")}</h3>
              <ul className="flex flex-col">{listed.map(placeRow)}</ul>
            </section>
          )}

          {selected && (
            <section
              aria-label={t("map.objectsAt", { place: selected.title })}
              className="flex flex-col gap-3"
            >
              <div className="flex items-baseline justify-between gap-3 px-2">
                <h3 className="label">{t("map.here")}</h3>
                <span className="flex items-center gap-2">
                  <span className="num text-xs text-fg-muted">
                    {t("map.hereCount", { count: here.length })}
                  </span>
                  <DeleteButton id={selected.id} />
                </span>
              </div>
              {here.length === 0 ? (
                <p className="px-2 text-fg-muted">{t("map.nothingHere")}</p>
              ) : (
                <ul className="flex flex-col items-start gap-2 px-1">
                  {here.map((o) =>
                    o ? (
                      <li key={o.id} className="max-w-full">
                        <ObjectChip
                          object={{ id: o.id, type: o.type, title: o.title, status: o.status }}
                          selected={peekId === o.id}
                          onPeek={onPeekObject}
                          href={hrefFor(o.id)}
                          meta={typeLabel(o.type)}
                        />
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {unplaced.length > 0 && (
        <section aria-label={t("map.unplaced")} className="flex flex-col gap-2">
          <h3 className="label px-2">{t("map.unplaced")}</h3>
          <p className="px-2 text-xs text-fg-muted">{t("map.unplacedBody")}</p>
          <ul className="flex flex-col">
            {unplaced.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="min-w-0 grow truncate px-2">{p.title}</span>
                <button
                  type="button"
                  onClick={() => onPlaceOnGlobe(p.id)}
                  className="shrink-0 rounded-control border border-border px-2 py-1 text-xs transition-colors duration-(--duration-hover) hover:bg-hover"
                >
                  {t("map.placeOnGlobe")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-auto text-xs text-fg-muted">{t("map.attribution")}</p>
    </aside>
  );
}
