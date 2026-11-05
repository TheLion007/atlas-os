import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./search";

describe("parseSearchQuery", () => {
  it("splits free text from #tag tokens", () => {
    expect(parseSearchQuery("Taxe 2024 #Dorsel #Finance")).toEqual({
      text: "Taxe 2024",
      tags: ["dorsel", "finance"],
    });
  });

  it("is pure free text when there is no tag", () => {
    expect(parseSearchQuery("Marina apartment")).toEqual({ text: "Marina apartment", tags: [] });
  });

  it("is pure tag filtering when there is no free text", () => {
    expect(parseSearchQuery("#RealEstate")).toEqual({ text: "", tags: ["realestate"] });
  });

  it("ignores a lone '#' (not a tag)", () => {
    expect(parseSearchQuery("price # 2024")).toEqual({ text: "price 2024", tags: [] });
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseSearchQuery("")).toEqual({ text: "", tags: [] });
    expect(parseSearchQuery("   ")).toEqual({ text: "", tags: [] });
  });
});
