import type { Metadata } from "next";
import { CommandCenter } from "@/components/command-center/CommandCenter";

export const metadata: Metadata = { title: "Overview · Atlas OS" };

export default function OverviewPage() {
  return <CommandCenter />;
}
