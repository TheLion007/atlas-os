import type { Metadata } from "next";
import { CollectionLens } from "@/components/lenses/CollectionLens";

export const metadata: Metadata = { title: "Risk · Atlas OS" };

export default function RiskPage() {
  return <CollectionLens type="risk" />;
}
