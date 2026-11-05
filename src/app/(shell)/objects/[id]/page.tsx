import type { Metadata } from "next";
import { ObjectPageView } from "@/components/lenses/ObjectPageView";

export const metadata: Metadata = { title: "Object · Atlas OS" };

export default async function ObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ObjectPageView id={id} />;
}
