import type { Metadata } from "next";
import { CalendarLens } from "@/components/lenses/CalendarLens";

export const metadata: Metadata = { title: "Calendar · Atlas OS" };

export default function CalendarPage() {
  return <CalendarLens />;
}
