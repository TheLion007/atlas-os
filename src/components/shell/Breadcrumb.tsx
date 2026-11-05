"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { Icon } from "../ui/Icon";

export interface Crumb {
  label: string;
  /** Absent on the page you are on. */
  href?: string;
}

/**
 * Where you are, and the way back. The arrow goes to the screen you came from (the browser's own
 * history), or to the parent crumb when this page was opened directly; every crumb above the
 * current page is a link.
 */
export function Breadcrumb({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const parent = [...crumbs].reverse().find((c) => c.href)?.href ?? "/";

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(parent);
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={back}
        aria-label={t("crumb.back")}
        className="inline-flex size-9 items-center justify-center rounded-control border border-border bg-surface text-fg-muted shadow-card transition-[transform,color] duration-(--duration-hover) hover:-translate-x-0.5 hover:text-fg"
      >
        <Icon name="chevronLeft" />
      </button>
      <nav aria-label={t("crumb.label")}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {crumbs.map((c, i) => (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-2">
              {i > 0 && <Icon name="chevronRight" className="shrink-0 text-fg-subtle" />}
              {c.href ? (
                <Link
                  href={c.href}
                  className="rounded-control px-1 transition-colors duration-(--duration-hover) hover:text-fg"
                >
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="max-w-64 truncate font-medium text-fg">
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
