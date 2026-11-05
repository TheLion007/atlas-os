import type { Metadata } from "next";
import { CollectionLens } from "@/components/lenses/CollectionLens";

export const metadata: Metadata = { title: "Plan · Atlas OS" };

export default function PlanPage() {
  return <CollectionLens type="plan" />;
}
