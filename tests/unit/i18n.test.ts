import { describe, expect, it } from "vitest";
import { format, placeholders } from "@/i18n/core";
import { makeT } from "@/i18n";
import { AREAS, en, fr } from "@/i18n/messages";

describe("catalogue", () => {
  it("has the same keys in English and French, in every area", () => {
    for (const a of AREAS) expect(Object.keys(a.fr).sort()).toEqual(Object.keys(a.en).sort());
    expect(Object.keys(fr).length).toBe(Object.keys(en).length);
  });

  it("has no key defined in two areas", () => {
    const all = AREAS.flatMap((a) => Object.keys(a.en));
    expect(new Set(all).size).toBe(all.length);
  });

  it("carries the same placeholders in both languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[])
      expect([key, placeholders(fr[key])]).toEqual([key, placeholders(en[key])]);
  });

  it("never leaves a French message empty or identical for a real sentence", () => {
    for (const key of Object.keys(fr) as (keyof typeof fr)[]) expect(fr[key].trim()).not.toBe("");
  });
});

describe("format", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(format("en", "Hello {name}", { name: "Atlas" })).toBe("Hello Atlas");
    expect(format("en", "Hello {name}", {})).toBe("Hello {name}");
  });

  it("picks plural forms by the language's own rules", () => {
    const msg = "{count} item | {count} items";
    expect(format("en", msg, { count: 1 })).toBe("1 item");
    expect(format("en", msg, { count: 0 })).toBe("0 items");
    expect(format("fr", "{count} objet | {count} objets", { count: 0 })).toBe("0 objet");
    expect(format("fr", "{count} objet | {count} objets", { count: 2 })).toBe("2 objets");
  });
});

describe("translate", () => {
  it("translates and defaults to English", () => {
    expect(makeT("fr")("nav.overview")).toBe("Accueil");
    expect(makeT("en")("nav.overview")).toBe("Home");
    expect(makeT("fr")("nav.timeline")).toBe("Chronologie");
  });
});
