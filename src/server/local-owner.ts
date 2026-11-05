import { timingSafeEqual } from "node:crypto";
import type { Authenticator } from "./auth";

/**
 * The single owner of this local installation. Atlas OS runs on one machine for one person, so
 * there is no sign-in: every request is that owner. The id matches the `owner_id` already stored
 * on every row, which keeps the row-level-security path (`asOwner`) unchanged.
 *
 * Safe only because Next.js listens on 127.0.0.1 alone (see the `dev` and `start` scripts).
 */
export const LOCAL_OWNER_ID = "94e3e13a-ee19-40ae-8a7d-6087a1db84c6";

/** The header the desktop app's window adds to every request it makes to its own server. */
export const DESKTOP_TOKEN_HEADER = "x-atlas-token";

/**
 * In the desktop app, the server also asks for a secret made up at each launch, known only to the
 * app's own window: another program on this PC (or a web page in a browser) that finds the port
 * cannot use the API. Without the secret set (development, `next start`) nothing is asked.
 */
export function hasDesktopToken(req: Request): boolean {
  const expected = process.env.ATLAS_DESKTOP_TOKEN;
  if (!expected) return true;
  const given = req.headers.get(DESKTOP_TOKEN_HEADER) ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const localOwnerAuth: Authenticator = async (req) =>
  hasDesktopToken(req) ? LOCAL_OWNER_ID : null;
