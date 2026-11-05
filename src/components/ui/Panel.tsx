import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled card: hairline border, 8px radius, flat. The unit of dashboard layout. */
export function Panel({ title, action, children, className }: PanelProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col rounded-[20px] border border-border bg-surface shadow-card",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-[18px] pb-1">
        <h2 id={id} className="font-display text-[17px] font-bold">
          {title}
        </h2>
        {action}
      </header>
      <div className="min-w-0 grow px-5 pt-3 pb-5">{children}</div>
    </section>
  );
}
