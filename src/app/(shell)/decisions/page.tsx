import type { Metadata } from "next";
import { CollectionLens } from "@/components/lenses/CollectionLens";

export const metadata: Metadata = { title: "Decision · Atlas OS" };

export default function DecisionPage() {
  return <CollectionLens type="decision" />;
}
