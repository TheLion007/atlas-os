import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** Liveness probe. Deliberately touches no database and returns no secrets. */
export function GET() {
  return NextResponse.json({ status: "ok", name: pkg.name, version: pkg.version });
}
