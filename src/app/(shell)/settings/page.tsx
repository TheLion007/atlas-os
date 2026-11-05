import type { Metadata } from "next";
import { SettingsLens } from "@/components/lenses/SettingsLens";

export const metadata: Metadata = { title: "Settings · Atlas OS" };

export default function SettingsPage() {
  return <SettingsLens />;
}
