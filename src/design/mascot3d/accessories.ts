/**
 * Pip's wardrobe. Level pieces unlock as points are earned (200 points a level, as in the dock);
 * seasonal pieces unlock by finishing tasks during the season itself.
 */
export type Slot = "hat" | "face" | "back";
export type Season = "halloween" | "winter";

export type AccessoryId =
  "beanie" | "glasses" | "party" | "bow" | "sunglasses" | "crown" | "witch" | "ghost" | "santa";

export type Unlock =
  { kind: "level"; level: number } | { kind: "season"; season: Season; tasks: number };

export interface Accessory {
  id: AccessoryId;
  slot: Slot;
  unlock: Unlock;
}

export const POINTS_PER_LEVEL = 200;

export const ACCESSORIES: readonly Accessory[] = [
  { id: "beanie", slot: "hat", unlock: { kind: "level", level: 2 } },
  { id: "glasses", slot: "face", unlock: { kind: "level", level: 3 } },
  { id: "party", slot: "hat", unlock: { kind: "level", level: 4 } },
  { id: "bow", slot: "hat", unlock: { kind: "level", level: 5 } },
  { id: "sunglasses", slot: "face", unlock: { kind: "level", level: 6 } },
  { id: "crown", slot: "hat", unlock: { kind: "level", level: 8 } },
  { id: "witch", slot: "hat", unlock: { kind: "season", season: "halloween", tasks: 3 } },
  { id: "ghost", slot: "back", unlock: { kind: "season", season: "halloween", tasks: 8 } },
  { id: "santa", slot: "hat", unlock: { kind: "season", season: "winter", tasks: 3 } },
];

/** What Pip wears: at most one piece per slot. */
export type Outfit = Partial<Record<Slot, AccessoryId>>;

export const levelOf = (points: number): number =>
  Math.max(1, Math.floor(Math.max(0, points) / POINTS_PER_LEVEL) + 1);

/** The season a date falls in: Halloween (24 Oct – 1 Nov) and winter holidays (1 – 26 Dec). */
export function seasonOf(date: Date): Season | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if ((m === 10 && d >= 24) || (m === 11 && d <= 1)) return "halloween";
  if (m === 12 && d <= 26) return "winter";
  return null;
}

/** Key under which a season's finished tasks are counted: one count per season and year. */
export const seasonKey = (season: Season, date: Date): string => `${season}-${date.getFullYear()}`;

/** Seasonal pieces that have been earned: the ones whose task count has been reached. */
export function seasonUnlocks(counts: Readonly<Record<string, number>>): AccessoryId[] {
  const out: AccessoryId[] = [];
  for (const a of ACCESSORIES) {
    const u = a.unlock;
    if (u.kind !== "season") continue;
    const best = Object.entries(counts)
      .filter(([key]) => key.startsWith(`${u.season}-`))
      .reduce((most, [, n]) => Math.max(most, n), 0);
    if (best >= u.tasks) out.push(a.id);
  }
  return out;
}

/** Everything Pip may wear right now: level pieces from the points, seasonal ones from the counts. */
export function availableAccessories(
  points: number,
  counts: Readonly<Record<string, number>>,
): AccessoryId[] {
  const level = levelOf(points);
  const seasonal = new Set(seasonUnlocks(counts));
  return ACCESSORIES.filter((a) =>
    a.unlock.kind === "level" ? level >= a.unlock.level : seasonal.has(a.id),
  ).map((a) => a.id);
}

export const accessoryById = (id: AccessoryId): Accessory =>
  ACCESSORIES.find((a) => a.id === id) as Accessory;

/** An outfit with anything no longer available (or unknown) taken off. */
export function cleanOutfit(outfit: Outfit, available: readonly AccessoryId[]): Outfit {
  const out: Outfit = {};
  for (const slot of ["hat", "face", "back"] as const) {
    const id = outfit[slot];
    if (id && available.includes(id) && accessoryById(id)?.slot === slot) out[slot] = id;
  }
  return out;
}
