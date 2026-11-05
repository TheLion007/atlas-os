import { z } from "zod";

/** Resolves the acting owner's id from a request, or `null` when the caller is not authenticated. */
export type Authenticator = (req: Request) => Promise<string | null>;

/** Deny by default: nobody is authenticated. */
export const denyAll: Authenticator = async () => null;

/**
 * Development-only shortcut: acts as the owner named by `ATLAS_DEV_OWNER_ID`.
 *
 * It is **ignored whenever `NODE_ENV` is `production`**, and returns `null` (deny) unless the
 * variable is a valid UUID. The local app uses `localOwnerAuth` instead (src/server/local-owner.ts); this stays for tests.
 */
export const devBypass: Authenticator = async () => {
  if (process.env.NODE_ENV === "production") return null;
  const id = process.env.ATLAS_DEV_OWNER_ID;
  return id && z.uuid().safeParse(id).success ? id : null;
};
