import { describe, expect, it } from "vitest";
import { createObjectSchema } from "./schemas";
import { SEARCH_TEXT_MAX, buildSearchText } from "./search-text";

const parse = (input: unknown) => createObjectSchema.parse(input);

describe("buildSearchText", () => {
  it("includes tags and free text but not the title (indexed separately)", () => {
    const text = buildSearchText(
      parse({
        type: "project",
        title: "Marina Apartment",
        tags: ["property", "dorsel"],
        details: { description: "Sea view, second floor" },
      }),
    );
    expect(text).toContain("property");
    expect(text).toContain("Sea view, second floor");
    expect(text).not.toContain("Marina Apartment");
  });

  it("indexes location parts for any country", () => {
    const text = buildSearchText(
      parse({
        type: "location",
        title: "Old Town",
        details: {
          countryCode: "BE",
          city: "Bremont",
          district: "Ironfield",
          lat: 50.83,
          lng: 4.37,
        },
      }),
    );
    expect(text).toContain("Bremont");
    expect(text).toContain("Ironfield");
    expect(text).toContain("BE");
  });

  it("indexes decision options and rationale", () => {
    const text = buildSearchText(
      parse({
        type: "decision",
        title: "Which?",
        details: {
          options: [{ id: "a", label: "Marina 1BR" }],
          rationale: "yield",
        },
      }),
    );
    expect(text).toContain("Marina 1BR");
    expect(text).toContain("yield");
  });

  it("indexes note block text", () => {
    const text = buildSearchText(
      parse({
        type: "note",
        title: "n",
        details: { blocks: [{ id: "1", text: "call the agent" }] },
      }),
    );
    expect(text).toContain("call the agent");
  });

  it("skips empty and null parts without stray whitespace", () => {
    const text = buildSearchText(parse({ type: "task", title: "t", details: {} }));
    expect(text).toBe("");
  });

  it("is deterministic and bounded", () => {
    const big = "x".repeat(SEARCH_TEXT_MAX * 2);
    const input = parse({
      type: "note",
      title: "n",
      details: {
        blocks: [
          { id: "1", text: big.slice(0, 20_000) },
          { id: "2", text: big.slice(0, 20_000) },
        ],
      },
    });
    expect(buildSearchText(input)).toBe(buildSearchText(input));
    expect(buildSearchText(input).length).toBeLessThanOrEqual(SEARCH_TEXT_MAX);
  });
});
