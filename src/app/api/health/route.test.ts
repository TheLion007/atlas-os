import { describe, expect, it } from "vitest";
import pkg from "../../../../package.json";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok with the app name and version", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "atlas-os", version: pkg.version });
  });
});
