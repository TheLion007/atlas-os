"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { SCENARIO_VARIANTS, type ScenarioVariant } from "@/domain/enums";

/**
 * Shareable UI state lives in the URL, so switching lenses preserves it ("Switching a lens
 * preserves selection and filters") and a link reproduces a view. Other params are untouched.
 */
export function useQueryParam(name: string): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const value = params.get(name);

  const set = useCallback(
    (next: string | null) => {
      const copy = new URLSearchParams(params.toString());
      if (next === null || next === "") copy.delete(name);
      else copy.set(name, next);
      const qs = copy.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, name],
  );
  return [value, set];
}

/** The scenario being viewed. The committed scenario is the default. */
export function useScenario(
  committed: ScenarioVariant = "base",
): [ScenarioVariant, (next: ScenarioVariant) => void] {
  const [raw, setRaw] = useQueryParam("scenario");
  const value = SCENARIO_VARIANTS.find((v) => v === raw) ?? committed;
  // Choosing the committed scenario clears the param: a clean URL means "the plan".
  return [value, (next) => setRaw(next === committed ? null : next)];
}

/** The object being peeked, if any. */
export function usePeek(): [string | null, (id: string | null) => void] {
  return useQueryParam("peek");
}
