import type { Metadata } from "next";
import { MapLens } from "@/components/lenses/MapLens";

export const metadata: Metadata = { title: "Map · Atlas OS" };

export default function MapPage() {
  return <MapLens />;
}
