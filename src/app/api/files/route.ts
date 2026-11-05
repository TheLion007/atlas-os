import { route } from "@/server/http";
import { ApiError } from "@/server/errors";
import { createDbFileStore, MAX_FILE_BYTES } from "@/server/files/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/files — stores one file (multipart field `file`) and returns where it lives. It does
 * not create a document: the client creates the document object with this metadata next, so the
 * metadata and its relations go through the ordinary, validated object API.
 */
export const POST = route(async ({ req, owner, db }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "validation", "Expected a multipart form with a file.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, "validation", "No file was sent.");
  if (file.size > MAX_FILE_BYTES)
    throw new ApiError(413, "too_large", "This file is larger than 25 MB.");
  const name = file instanceof File && file.name ? file.name : "file";
  const stored = await createDbFileStore(db).put(owner, {
    name,
    mime: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return Response.json(stored, { status: 201 });
});
