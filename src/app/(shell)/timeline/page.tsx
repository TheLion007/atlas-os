import type { Metadata } from "next";
import { TimelineLens } from "@/components/lenses/TimelineLens";

export const metadata: Metadata = { title: "Timeline · Atlas OS" };

export default function TimelinePage() {
  return <TimelineLens />;
}
