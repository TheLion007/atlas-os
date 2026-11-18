import { describe, expect, it } from "vitest";
import {
  availableAccessories,
  cleanOutfit,
  levelOf,
  seasonKey,
  seasonOf,
  seasonUnlocks,
} from "./accessories";

describe("Pip's wardrobe", () => {
  it("counts a level every 200 points, from level 1", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(199)).toBe(1);
    expect(levelOf(200)).toBe(2);
    expect(levelOf(1400)).toBe(8);
  });

  it("unlocks level pieces as the levels come", () => {
    expect(availableAccessories(0, {})).toEqual([]);
    expect(availableAccessories(200, {})).toEqual(["beanie"]);
    expect(availableAccessories(400, {})).toEqual(["beanie", "glasses"]);
    expect(availableAccessories(1400, {})).toContain("crown");
  });

  it("knows the seasons", () => {
    expect(seasonOf(new Date(2026, 9, 31))).toBe("halloween");
    expect(seasonOf(new Date(2026, 10, 1))).toBe("halloween");
    expect(seasonOf(new Date(2026, 9, 23))).toBeNull();
    expect(seasonOf(new Date(2026, 11, 12))).toBe("winter");
    expect(seasonOf(new Date(2026, 11, 27))).toBeNull();
    expect(seasonKey("halloween", new Date(2026, 9, 31))).toBe("halloween-2026");
  });

  it("gives the witch hat after three Halloween tasks, the ghost cape after eight", () => {
    expect(seasonUnlocks({ "halloween-2026": 2 })).toEqual([]);
    expect(seasonUnlocks({ "halloween-2026": 3 })).toEqual(["witch"]);
    expect(seasonUnlocks({ "halloween-2026": 8 })).toEqual(["witch", "ghost"]);
    expect(seasonUnlocks({ "winter-2026": 3 })).toEqual(["santa"]);
  });

  it("keeps a seasonal piece once earned in any year", () => {
    expect(seasonUnlocks({ "halloween-2025": 4, "halloween-2026": 1 })).toEqual(["witch"]);
  });

  it("takes off what is not owned, or sits in the wrong place", () => {
    expect(cleanOutfit({ hat: "crown", face: "glasses" }, ["glasses"])).toEqual({
      face: "glasses",
    });
    expect(cleanOutfit({ hat: "glasses" }, ["glasses"])).toEqual({});
  });
});
