"use client";

import { cn } from "@/lib/cn";

/** The switch and the row every Settings card is made of. */
export function Toggle({
  on,
  onChange,
  label,
  quiet,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-sound={quiet ? "none" : undefined}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300",
        on ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 size-5 rounded-full bg-on-accent shadow-card transition-transform duration-300 ease-(--ease-spring)",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

export function Row({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{title}</p>
        {sub && <p className="text-[12px] text-fg-subtle">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** The small button of the Settings cards. */
export const plainButton =
  "rounded-[10px] border border-border-strong bg-surface px-3 py-[5px] text-[12px] font-medium transition-[background-color,transform] hover:bg-sunk active:scale-[0.96] disabled:opacity-50";
