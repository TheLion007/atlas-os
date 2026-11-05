import type { Metadata } from "next";
import { HistoryLens } from "@/components/lenses/HistoryLens";

export const metadata: Metadata = { title: "Work history · Atlas OS" };

export default function HistoryPage() {
  return <HistoryLens />;
}
