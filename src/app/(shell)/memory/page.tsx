import type { Metadata } from "next";
import { MemoryLens } from "@/components/lenses/MemoryLens";

export const metadata: Metadata = { title: "Memory · Atlas OS" };

export default function MemoryPage() {
  return <MemoryLens />;
}
