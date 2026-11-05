import type { Metadata } from "next";
import { DocumentsLens } from "@/components/lenses/DocumentsLens";

export const metadata: Metadata = { title: "Documents · Atlas OS" };

export default function DocumentsPage() {
  return <DocumentsLens />;
}
