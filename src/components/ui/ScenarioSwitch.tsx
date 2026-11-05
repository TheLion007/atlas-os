"use client";

import { useId } from "react";
import { SCENARIO_VARIANTS, type ScenarioVariant } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

interface ScenarioSwitchProps {
  value: ScenarioVariant;
  /** The committed scenario. When `value` differs, the view is a preview (the "dirty" state). */
  committed?: ScenarioVariant;
  onChange: (next: ScenarioVariant) => void;
  /** Return to the committed scenario. Shown only while previewing. */
  onReset?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The global scenario control. Changing it re-projects every view, and until the change is
 * committed the views are a preview, which is flagged so nobody mistakes a what-if for the plan.
 * Built on native radio inputs: arrow keys, focus and screen-reader semantics come for free.
 */
export function ScenarioSwitch({
  value,
  committed,
  onChange,
  onReset,
  disabled = false,
  className,
}: ScenarioSwitchProps) {
  const group = useId();
  const { t } = useI18n();
  const dirty = committed !== undefined && value !== committed;

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-state={dirty ? "dirty" : "clean"}
    >
      <fieldset disabled={disabled} className="m-0 border-0 p-0">
        <legend className="sr-only">{t("scenario.legend")}</legend>
        <div className="inline-flex rounded-control border border-border p-1">
          {SCENARIO_VARIANTS.map((variant) => (
            <label
              key={variant}
              className={cn(
                "relative cursor-pointer rounded-control px-3 py-1 text-sm transition-colors duration-(--duration-hover)",
                "has-[:checked]:bg-selected has-[:checked]:text-fg",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg",
                "text-fg-muted hover:text-fg",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name={group}
                value={variant}
                checked={value === variant}
                disabled={disabled}
                onChange={() => onChange(variant)}
                className="sr-only"
              />
              <span aria-hidden="true" className="md:hidden">
                {t(`scenario.${variant}Short`)}
              </span>
              <span className="sr-only md:not-sr-only">{t(`scenario.${variant}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {dirty && (
        <span className="label inline-flex items-center gap-2" role="status">
          <span aria-hidden="true" className="inline-block size-2 rounded-full border border-fg" />
          {t("scenario.preview")}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-control px-1 underline underline-offset-4 hover:text-fg"
            >
              {t("scenario.backTo", { name: t(`scenario.${committed}`) })}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
