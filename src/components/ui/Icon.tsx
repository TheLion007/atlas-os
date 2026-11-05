import type { ReactNode } from "react";

/**
 * Interface icons: the same 16×16 geometric language as TypeGlyph (1.5px stroke, round caps).
 * Drawn for Atlas rather than taken from a stock set, so the interface has its own voice.
 * Icons are decorative; the accessible name always lives on the control that holds them.
 */
const PATHS = {
  overview: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  map: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <ellipse cx="8" cy="8" rx="2.4" ry="5.5" />
      <path d="M2.5 8h11" />
    </>
  ),
  graph: (
    <>
      <circle cx="4" cy="4.5" r="1.6" />
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <path d="M5.4 5.2l5.2.3M4.8 6l2.2 4.6M11.2 7l-2.4 3.8" />
    </>
  ),
  timeline: <path d="M3 4h5M6 8h7M4 12h6" />,
  history: (
    <>
      <rect x="2.5" y="2.5" width="3" height="3" rx=".6" />
      <rect x="6.5" y="2.5" width="3" height="3" rx=".6" />
      <rect x="10.5" y="2.5" width="3" height="3" rx=".6" />
      <rect x="2.5" y="6.5" width="3" height="3" rx=".6" />
      <rect x="6.5" y="6.5" width="3" height="3" rx=".6" />
      <rect x="2.5" y="10.5" width="3" height="3" rx=".6" />
    </>
  ),
  finance: <path d="M2.5 12.5l3.5-4 2.6 2.4L13.5 4.5M10.5 4.5h3v3" />,
  settings: (
    <>
      <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" />
      <circle cx="10" cy="5" r="1.5" />
      <circle cx="6" cy="11" r="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </>
  ),
  assistant: (
    <>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
      <path d="M5.5 6.5h5" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  close: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  pin: (
    <>
      <path d="M6 2.5h4l-.5 4 2 2H4.5l2-2z" />
      <path d="M8 8.5v5" />
    </>
  ),
  chevronLeft: <path d="M9.5 3.5L5 8l4.5 4.5" />,
  chevronRight: <path d="M6.5 3.5L11 8l-4.5 4.5" />,
  external: <path d="M6.5 3.5h6v6M12.5 3.5l-7 7M10 12.5H3.5V6" />,
  plus: <path d="M8 3v10M3 8h10" />,
  arrowUp: <path d="M8 13V3.5M4.5 7L8 3.5 11.5 7" />,
  arrowDown: <path d="M8 3v9.5M4.5 9L8 12.5 11.5 9" />,
  minus: <path d="M3 8h10" />,
  fit: <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />,
  reset: <path d="M3.5 8a4.5 4.5 0 1 0 1.5-3.4M3.2 2.8v2.4h2.4" />,
  focus: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 2v2.4M8 11.6V14M2 8h2.4M11.6 8H14" />
    </>
  ),
  isolate: (
    <>
      <circle cx="8" cy="8" r="1.8" />
      <circle cx="8" cy="8" r="5.5" strokeDasharray="1.6 2.4" />
    </>
  ),
  causes: (
    <>
      <circle cx="3.5" cy="12" r="1.4" />
      <circle cx="12.5" cy="4" r="1.4" />
      <path d="M5 12h2.5a3 3 0 0 0 3-3V5.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <ellipse cx="8" cy="8" rx="2.4" ry="5.5" />
      <path d="M2.5 8h11" />
    </>
  ),
  chevronDown: <path d="M3.5 6.5L8 11l4.5-4.5" />,
  upload: <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3" />,
  download: <path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 10v3h11v-3" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  play: <path d="M5.5 3v10l7-5z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
