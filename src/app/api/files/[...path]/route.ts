import { route } from "@/server/http";
import { notFound } from "@/server/errors";
import { createDbFileStore, servingHeaders } from "@/server/files/store";

export const dynamic = "force-dynamic";

/** The storage path from the URL (the client encodes it as one segment). */
function pathOf(params: Record<string, string | string[]>): string {
  const raw = params.path;
  const joined = Array.isArray(raw) ? raw.join("/") : (raw ?? "");
  return decodeURIComponent(joined);
}

/** GET /api/files/:storagePath — the owner's file, served safely (see servingHeaders). */
export const GET = route(async ({ owner, db, params }) => {
  const storagePath = pathOf(params);
  const file = await createDbFileStore(db).get(owner, storagePath);
  if (!file) throw notFound("File");
  const name = storagePath.split("/").pop() ?? "file";
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: servingHeaders(file.mime, name),
  });
});

/** DELETE /api/files/:storagePath — removes a stored file (e.g. after a failed import). */
export const DELETE = route(async ({ owner, db, params }) => {
  await createDbFileStore(db).remove(owner, pathOf(params));
  return new Response(null, { status: 204 });
});
