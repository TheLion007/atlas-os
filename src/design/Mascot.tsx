"use client";

import { useEffect, useRef } from "react";
import type { MascotMood } from "@/lib/feedback/celebrate";
import type { MascotKind } from "@/lib/feedback/prefs";

interface MascotProps {
  kind?: MascotKind;
  mood?: MascotMood;
  size?: number;
  /** Pupils follow the pointer. */
  track?: boolean;
  className?: string;
}

/**
 * The mascot: three little creatures (Pip, Moka, Fil) with the same face. It breathes while
 * idle, hops when something is done, sleeps when asked to, and its pupils follow the pointer.
 * Drawn inline as SVG so it inherits nothing from the theme: it looks the same on paper or charcoal.
 */
export function Mascot({
  kind = "pip",
  mood = "idle",
  size = 72,
  track = true,
  className,
}: MascotProps) {
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!track) return;
    const move = (e: MouseEvent) => {
      const el = svg.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.53);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(3.4, d / 35);
      const t = `translate(${((dx / d) * m).toFixed(2)} ${((dy / d) * m).toFixed(2)})`;
      el.querySelectorAll("[data-pupil]").forEach((p) => p.setAttribute("transform", t));
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [track]);

  const sleep = mood === "sleep";
  const joy = mood === "cheer" || mood === "happy";
  const show = (on: boolean) => (on ? "inline" : "none");
  const animation =
    mood === "cheer"
      ? "mascot-cheer 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)"
      : sleep
        ? "mascot-breathe 3.6s ease-in-out infinite"
        : "mascot-bob 3.4s ease-in-out infinite";
  const mouth = sleep
    ? "M46 70 Q50 72 54 70"
    : joy
      ? "M42 66 Q50 79 58 66 Z"
      : "M44 67 Q50 73 56 67";

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, animation, transformOrigin: "50% 92%", flex: "none" }}
    >
      <svg
        ref={svg}
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        style={{ overflow: "visible", display: "block" }}
      >
        <ellipse cx="50" cy="95" rx="25" ry="3.5" fill="rgba(0,0,0,.13)" />
        <g style={{ display: show(kind === "pip") }}>
          <path d="M50 5 L55 19 L50 23 L45 19 Z" fill="#DD5530" />
          <circle cx="50" cy="19" r="2.2" fill="#1D221F" />
          <path
            d="M50 22 C74 22 88 38 88 60 C88 80 72 92 50 92 C28 92 12 80 12 60 C12 38 26 22 50 22 Z"
            fill="#E8AC3E"
          />
          <ellipse cx="50" cy="74" rx="22" ry="14" fill="#F4CC7E" />
        </g>
        <g style={{ display: show(kind === "moka") }}>
          <path d="M20 36 L24 12 L42 27 Z M80 36 L76 12 L58 27 Z" fill="#74466F" />
          <rect x="13" y="22" width="74" height="70" rx="34" fill="#8E5C88" />
          <ellipse cx="50" cy="54" rx="30" ry="20" fill="#C29CBC" />
          <path d="M46 63 L50 69 L54 63 Z" fill="#E8AC3E" />
        </g>
        <g style={{ display: show(kind === "fil") }}>
          <path
            d="M50 27 C50 20 50 15 50 10"
            stroke="#3F5E32"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M50 15 C41 4 29 7 29 14 C37 19 45 19 50 15 Z" fill="#86AD68" />
          <path d="M50 12 C58 2 71 4 71 10 C63 15 56 15 50 12 Z" fill="#86AD68" />
          <path
            d="M50 25 C72 25 86 42 86 62 C86 81 70 92 50 92 C30 92 14 81 14 62 C14 42 28 25 50 25 Z"
            fill="#6B8F55"
          />
          <ellipse cx="50" cy="75" rx="21" ry="13" fill="#A2C186" />
        </g>
        <g
          style={{
            display: show(!sleep && !joy),
            animation: "mascot-blink 5.2s infinite",
            transformOrigin: "50px 53px",
          }}
        >
          <circle cx="38.5" cy="52" r="9.5" fill="#fff" />
          <circle cx="61.5" cy="52" r="9.5" fill="#fff" />
          <g data-pupil="1" style={{ transition: "transform .12s ease-out" }}>
            <circle cx="38.5" cy="53" r="5" fill="#1D221F" />
            <circle cx="40.3" cy="51.2" r="1.6" fill="#fff" />
          </g>
          <g data-pupil="1" style={{ transition: "transform .12s ease-out" }}>
            <circle cx="61.5" cy="53" r="5" fill="#1D221F" />
            <circle cx="63.3" cy="51.2" r="1.6" fill="#fff" />
          </g>
        </g>
        <path
          style={{ display: show(joy) }}
          d="M32 55 Q38.5 45 45 55 M55 55 Q61.5 45 68 55"
          stroke="#1D221F"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <g style={{ display: show(sleep) }}>
          <path
            d="M32 53 Q38.5 58 45 53 M55 53 Q61.5 58 68 53"
            stroke="#1D221F"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <text
            x="78"
            y="26"
            fontWeight="800"
            fontSize="14"
            fill="#7A7266"
            style={{ animation: "mascot-z 2.4s infinite" }}
          >
            z
          </text>
          <text
            x="86"
            y="16"
            fontWeight="800"
            fontSize="10"
            fill="#7A7266"
            style={{ animation: "mascot-z 2.4s 1.2s infinite" }}
          >
            z
          </text>
        </g>
        <ellipse cx="28" cy="63" rx="5.5" ry="3.2" fill="#F07A5A" opacity=".5" />
        <ellipse cx="72" cy="63" rx="5.5" ry="3.2" fill="#F07A5A" opacity=".5" />
        <path
          d={mouth}
          fill={joy ? "#7A2E1A" : "none"}
          stroke="#1D221F"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
