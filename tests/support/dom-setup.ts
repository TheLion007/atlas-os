import { afterEach } from "vitest";

/**
 * Loaded for every test file. Only does anything in jsdom (component tests opt in with
 * `// @vitest-environment jsdom`): unmounts between tests and fills the browser APIs jsdom lacks.
 */
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());

  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
}

/*
 * jsdom has no 2D canvas. Canvas-drawing components get a recording stand-in: every drawing call
 * is a no-op, measureText gives a plausible width, so the code paths run and interaction (hit
 * testing, camera, selection) can be tested without pixels. Real drawing is verified in a real
 * browser (scripts/verify-ui.mjs).
 */
if (typeof window !== "undefined" && typeof HTMLCanvasElement !== "undefined") {
  const noop = () => {};
  const ctx = new Proxy(
    { measureText: (t: string) => ({ width: t.length * 6 }), canvas: null },
    {
      get: (target, prop) => (prop in target ? (target as never)[prop] : noop),
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}
