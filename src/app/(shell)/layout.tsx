import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AtlasProvider } from "@/client/provider";
import { Shell } from "@/components/shell/Shell";
import { getSession } from "@/server/session";

// Every page in the shell needs a session, so nothing here is prerendered.
export const dynamic = "force-dynamic";

/** Every page in the shell runs as the single local owner (see src/server/local-owner.ts). */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) notFound();
  return (
    <AtlasProvider mode={session.mode}>
      <Shell>{children}</Shell>
    </AtlasProvider>
  );
}
