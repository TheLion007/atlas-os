import { z } from "zod";
import { getContext } from "./context";
import type { Db } from "./db/types";
import { ApiError, mapDbError } from "./errors";

export interface RouteArgs {
  req: Request;
  owner: string;
  db: Db;
  /** Route params; a catch-all segment (`[...path]`) arrives as an array. */
  params: Record<string, string | string[]>;
}

type RouteContext = { params?: Promise<Record<string, string | string[]>> };

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      { error: { code: e.code, message: e.message, ...(e.issues ? { issues: e.issues } : {}) } },
      { status: e.status },
    );
  }
  console.error("Unhandled API error:", e);
  return Response.json(
    { error: { code: "internal", message: "Something went wrong." } },
    { status: 500 },
  );
}

/** What a read-only session may still ask with a POST: asking the local model, copying data out. */
const READ_ONLY_OK = /^\/api\/(ollama\/|backup\/(export|inspect|status)$)/;

/**
 * Read-only mode (another PC has the data open): nothing may be written. The database itself is
 * a private copy then, and this refuses every write before it reaches it.
 */
function readOnlyGuard(req: Request): void {
  if (process.env.ATLAS_READONLY !== "1") return;
  if (req.method === "GET" || req.method === "HEAD") return;
  if (READ_ONLY_OK.test(new URL(req.url).pathname)) return;
  throw new ApiError(403, "read_only", "Atlas OS is open in read-only mode: nothing was changed.");
}

/**
 * Wraps a route handler: authenticates (401 when nobody is), resolves route params, and turns
 * every failure into a consistent `{ error: { code, message } }` body. Nothing internal leaks.
 */
export function route(handler: (args: RouteArgs) => Promise<Response>) {
  return async (req: Request, ctx?: RouteContext): Promise<Response> => {
    try {
      const { authenticate, getDb } = getContext();
      const owner = await authenticate(req);
      if (!owner) throw new ApiError(401, "unauthorized", "Authentication required.");
      readOnlyGuard(req);
      const params = ctx?.params ? await ctx.params : {};
      return await handler({ req, owner, db: getDb(), params });
    } catch (e) {
      return errorResponse(mapDbError(e));
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export function idParam(params: Record<string, string | string[]>): string {
  const parsed = z.uuid().safeParse(params.id);
  if (!parsed.success) throw new ApiError(400, "validation", "The id is not a valid UUID.");
  return parsed.data;
}
