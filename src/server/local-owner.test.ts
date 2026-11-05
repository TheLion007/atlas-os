import { describe, expect, it } from "vitest";
import { z } from "zod";
import { afterEach } from "vitest";
import { LOCAL_OWNER_ID, localOwnerAuth } from "./local-owner";

describe("local owner", () => {
  it("is a valid UUID", () => {
    expect(z.uuid().safeParse(LOCAL_OWNER_ID).success).toBe(true);
  });

  it("authenticates every request as the single local owner, without any credential", async () => {
    expect(await localOwnerAuth(new Request("http://127.0.0.1/"))).toBe(LOCAL_OWNER_ID);
  });

  describe("with the desktop secret", () => {
    afterEach(() => {
      delete process.env.ATLAS_DESKTOP_TOKEN;
    });

    it("lets the app's own window in and keeps everything else out", async () => {
      process.env.ATLAS_DESKTOP_TOKEN = "s3cret-for-this-launch";
      const url = "http://127.0.0.1:4000/";
      expect(await localOwnerAuth(new Request(url))).toBeNull();
      expect(
        await localOwnerAuth(new Request(url, { headers: { "x-atlas-token": "nope" } })),
      ).toBeNull();
      expect(
        await localOwnerAuth(
          new Request(url, { headers: { "x-atlas-token": "s3cret-for-this-launch" } }),
        ),
      ).toBe(LOCAL_OWNER_ID);
    });
  });
});
