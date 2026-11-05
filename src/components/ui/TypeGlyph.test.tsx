// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "@/domain/enums";
import { OBJECT_TYPE_STYLE } from "@/design/object-types";
import { axeViolations } from "../../../tests/support/a11y";
import { TypeGlyph } from "./TypeGlyph";

describe("TypeGlyph", () => {
  it("gives every object type its own shape, so colour is never the only cue", () => {
    const shapes = OBJECT_TYPES.map((type) => {
      const { container, unmount } = render(<TypeGlyph type={type} />);
      const html = container.querySelector("svg")?.innerHTML ?? "";
      unmount();
      return html;
    });
    expect(shapes.every((s) => s.length > 0)).toBe(true);
    expect(new Set(shapes).size).toBe(OBJECT_TYPES.length);
  });

  it("paints in the type colour by default and inherits when asked", () => {
    const { container, rerender } = render(<TypeGlyph type="project" />);
    const svg = () => container.querySelector("svg") as SVGElement;
    expect(svg().style.color).not.toBe("");
    expect(OBJECT_TYPE_STYLE.project.color).toMatch(/^#/);
    rerender(<TypeGlyph type="project" colored={false} />);
    expect(svg().style.color).toBe("");
  });

  it("is decorative: hidden from assistive technology, not focusable", async () => {
    const { container } = render(
      <p>
        <TypeGlyph type="risk" /> Supplier delay
      </p>,
    );
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("scales", () => {
    const { container } = render(<TypeGlyph type="task" size={24} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("24");
  });
});
