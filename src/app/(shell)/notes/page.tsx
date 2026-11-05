import type { Metadata } from "next";
import { NotesLens } from "@/components/lenses/NotesLens";

export const metadata: Metadata = { title: "Notes · Atlas OS" };

export default function NotesPage() {
  return <NotesLens />;
}
