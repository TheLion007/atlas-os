import type { Metadata } from "next";
import { GraphLens } from "@/components/lenses/GraphLens";

export const metadata: Metadata = { title: "Graph · Atlas OS" };

export default function GraphPage() {
  return <GraphLens />;
}
