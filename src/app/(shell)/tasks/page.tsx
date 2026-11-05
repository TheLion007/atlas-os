import type { Metadata } from "next";
import { CollectionLens } from "@/components/lenses/CollectionLens";

export const metadata: Metadata = { title: "Task · Atlas OS" };

export default function TaskPage() {
  return <CollectionLens type="task" />;
}
