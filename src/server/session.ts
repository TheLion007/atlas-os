import { headers } from "next/headers";
import { getContext } from "./context";

/**
 * The UI boundary. Every page in the app shell asks for a session here. Who the session belongs to
 * is behind `getContext().authenticate`: locally that is always the single owner of the machine.
 */
export interface Session {
  ownerId: string;
  /** "demo" is the dev-only fixture session; production never returns it. */
  mode: "authenticated" | "demo";
}

export const DEMO_OWNER = "00000000-0000-4000-8000-000000000000";

/** Fixture (demo) mode: development only, and only when explicitly switched on. */
export function fixturesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ATLAS_FIXTURES === "1";
}

export async function getSession(): Promise<Session | null> {
  if (fixturesEnabled()) return { ownerId: DEMO_OWNER, mode: "demo" };
  const request = new Request("http://internal.invalid/", { headers: await headers() });
  const ownerId = await getContext().authenticate(request);
  return ownerId ? { ownerId, mode: "authenticated" } : null;
}
