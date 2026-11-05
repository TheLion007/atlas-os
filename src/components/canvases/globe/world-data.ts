import type { FeatureCollection, Geometry, MultiLineString } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

/**
 * Real geography, and nothing else: land and country borders from Natural Earth (public
 * domain), bundled through the `world-atlas` package, so the globe works offline and asks
 * nothing of a third-party tile server. No border is invented. The 1:50m data is enough from
 * orbit down to a country and loads fast; 1:10m is available for closer work.
 */
export type WorldDetail = "50m" | "10m";

export interface World {
  land: FeatureCollection<Geometry>;
  borders: MultiLineString;
}

const cache = new Map<WorldDetail, Promise<World>>();

export function loadWorld(detail: WorldDetail = "50m"): Promise<World> {
  let pending = cache.get(detail);
  if (!pending) {
    pending = (async () => {
      const [{ feature, mesh }, module] = await Promise.all([
        import("topojson-client"),
        detail === "50m"
          ? import("world-atlas/countries-50m.json")
          : import("world-atlas/countries-10m.json"),
      ]);
      const topo = (module as unknown as { default: unknown }).default as Topology<{
        land: GeometryCollection;
        countries: GeometryCollection;
      }>;
      const land = feature(topo, topo.objects.land);
      return {
        land: (land.type === "FeatureCollection"
          ? land
          : { type: "FeatureCollection", features: [land] }) as FeatureCollection<Geometry>,
        borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
      };
    })();
    cache.set(detail, pending);
  }
  return pending;
}
