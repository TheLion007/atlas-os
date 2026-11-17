import { describe, expect, it } from "vitest";
import { EXPRESSIONS, PIP_EXPRESSIONS, expressionForMood } from "./expressions";

describe("Pip 3D expressions", () => {
  it("defines exactly nine expressions, each with a full spec", () => {
    expect(PIP_EXPRESSIONS).toHaveLength(9);
    for (const e of PIP_EXPRESSIONS) {
      expect(EXPRESSIONS[e]).toMatchObject({ eyes: expect.any(String), mouth: expect.any(String) });
    }
  });

  it("maps Atlas's mood words to what Pip shows", () => {
    expect(expressionForMood("idle")).toBe("idle");
    expect(expressionForMood("happy")).toBe("happy");
    expect(expressionForMood("cheer")).toBe("dancing");
    expect(expressionForMood("sleep")).toBe("sleeping");
  });
});
