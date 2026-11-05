import { CanvasTexture, SRGBColorSpace } from "three";
import { SPACE_COLORS as C, GLOBE_COLORS as G } from "@/design/tokens";
import { borderPaths, landPaths } from "./equirect";
import { loadWorld, type WorldDetail } from "./world-data";

/**
 * The globe's surface texture, drawn once from the same real Natural Earth data the flat map
 * used, at the same restrained Atlas palette: an equirectangular canvas (land, coastlines,
 * country borders, a faint graticule) becomes a `THREE.CanvasTexture` wrapped around the sphere.
 * No photographic imagery is downloaded — everything here is real vector geography, coloured,
 * not photographed.
 */
export interface EarthTextures {
  /** The colour map: what the lit side of the globe shows. */
  map: CanvasTexture;
  /** A dim, warm-neutral version of the same map, so the night side of the globe (lit only by
   *  the scene's ambient light) still reads as a planet and not a black disc. It is not city-
   *  light data — Atlas has none — only a restrained self-illumination of the same real land. */
  emissive: CanvasTexture;
}

function drawPaths(
  ctx: CanvasRenderingContext2D,
  paths: readonly { x: number; y: number }[][],
  close: boolean,
): void {
  ctx.beginPath();
  for (const ring of paths) {
    ctx.moveTo(ring[0]!.x, ring[0]!.y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
    if (close) ctx.closePath();
  }
}

function drawGraticule(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.beginPath();
  for (let lng = -180; lng <= 180; lng += 30) {
    const x = ((lng + 180) / 360) * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function paintBase(
  canvas: HTMLCanvasElement,
  land: ReturnType<typeof landPaths>,
  borders: ReturnType<typeof borderPaths>,
  emissive: boolean,
) {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = emissive ? G.nightBase : C.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = C.fgMuted;
  ctx.lineWidth = 1;
  ctx.globalAlpha = emissive ? 0.05 : 0.12;
  drawGraticule(ctx, width, height);

  ctx.globalAlpha = emissive ? 0.1 : 1;
  ctx.fillStyle = emissive ? G.nightLand : C.fgMuted;
  drawPaths(ctx, land, true);
  ctx.fill();

  ctx.globalAlpha = emissive ? 0.14 : 0.9;
  ctx.strokeStyle = emissive ? G.nightCoast : C.fgMuted;
  ctx.lineWidth = 1.1;
  drawPaths(ctx, land, true);
  ctx.stroke();

  ctx.globalAlpha = emissive ? 0 : 0.6;
  if (!emissive) {
    // Drawn in the background colour, not `fgMuted`: a border line the same colour as the land
    // fill it sits on (previously the case) blends away to nothing — only a line darker than the
    // land actually reads as a seam between countries.
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 2]);
    drawPaths(ctx, borders, false);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

const cache = new Map<WorldDetail, Promise<EarthTextures>>();

export function buildEarthTextures(
  detail: WorldDetail = "50m",
  width = 2048,
  height = 1024,
): Promise<EarthTextures> {
  let pending = cache.get(detail);
  if (!pending) {
    pending = loadWorld(detail).then((world) => {
      const land = landPaths(world.land, width, height);
      const borders = borderPaths(world.borders, width, height);

      const dayCanvas = document.createElement("canvas");
      dayCanvas.width = width;
      dayCanvas.height = height;
      paintBase(dayCanvas, land, borders, false);

      const nightCanvas = document.createElement("canvas");
      nightCanvas.width = width;
      nightCanvas.height = height;
      paintBase(nightCanvas, land, borders, true);

      const map = new CanvasTexture(dayCanvas);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 4;
      const emissive = new CanvasTexture(nightCanvas);
      emissive.colorSpace = SRGBColorSpace;
      return { map, emissive };
    });
    cache.set(detail, pending);
  }
  return pending;
}
