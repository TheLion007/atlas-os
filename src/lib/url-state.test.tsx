// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/graph",
  useRouter: () => ({ replace }),
}));

import { usePeek, useQueryParam, useScenario } from "./url-state";

beforeEach(() => {
  replace.mockClear();
  search = "";
});

describe("useQueryParam", () => {
  it("reads and sets a parameter, leaving others alone", () => {
    search = "scenario=optimistic&filter=risk";
    const { result } = renderHook(() => useQueryParam("peek"));
    expect(result.current[0]).toBeNull();
    result.current[1]("abc");
    expect(replace).toHaveBeenCalledWith("/graph?scenario=optimistic&filter=risk&peek=abc", {
      scroll: false,
    });
  });

  it("removes a parameter and drops the query string when it is the last one", () => {
    search = "peek=abc";
    const { result } = renderHook(() => useQueryParam("peek"));
    result.current[1](null);
    expect(replace).toHaveBeenCalledWith("/graph", { scroll: false });
  });
});

describe("useScenario", () => {
  it("defaults to the committed scenario", () => {
    const { result } = renderHook(() => useScenario("base"));
    expect(result.current[0]).toBe("base");
  });

  it("reads a valid scenario from the URL and ignores nonsense", () => {
    search = "scenario=conservative";
    expect(renderHook(() => useScenario("base")).result.current[0]).toBe("conservative");
    search = "scenario=reckless";
    expect(renderHook(() => useScenario("base")).result.current[0]).toBe("base");
  });

  it("previews by setting the param, and clears it when returning to the committed scenario", () => {
    const { result } = renderHook(() => useScenario("base"));
    result.current[1]("optimistic");
    expect(replace).toHaveBeenLastCalledWith("/graph?scenario=optimistic", { scroll: false });
    result.current[1]("base");
    expect(replace).toHaveBeenLastCalledWith("/graph", { scroll: false });
  });
});

describe("usePeek", () => {
  it("uses the peek parameter", () => {
    search = "peek=obj-1";
    expect(renderHook(() => usePeek()).result.current[0]).toBe("obj-1");
  });
});
