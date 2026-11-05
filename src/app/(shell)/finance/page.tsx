import type { Metadata } from "next";
import { FinanceLens } from "@/components/lenses/FinanceLens";

export const metadata: Metadata = { title: "Finance · Atlas OS" };

export default function FinancePage() {
  return <FinanceLens />;
}
