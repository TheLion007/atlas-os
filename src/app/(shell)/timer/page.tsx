import type { Metadata } from "next";
import { TimerLens } from "@/components/lenses/TimerLens";

export const metadata: Metadata = { title: "Timer · Atlas OS" };

export default function TimerPage() {
  return <TimerLens />;
}
