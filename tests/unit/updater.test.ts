import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isUpdateRequest, classifyError, UPDATE_HOSTS, CHECK_EVERY_MS } =
  require("../../electron/updater.cjs") as {
    isUpdateRequest: (
      d: { url: string; webContentsId?: number },
      local: (h: string) => boolean,
    ) => boolean;
    classifyError: (e: unknown, phase: "check" | "download") => string;
    UPDATE_HOSTS: string[];
    CHECK_EVERY_MS: number;
  };

const isLocal = (h: string) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(h);
const fromUpdater = (url: string) => isUpdateRequest({ url }, isLocal);
const fromPage = (url: string) => isUpdateRequest({ url, webContentsId: 3 }, isLocal);

describe("the network rule and the update check", () => {
  it("lets the updater reach GitHub's release hosts over https, and nothing else", () => {
    for (const host of UPDATE_HOSTS) expect(fromUpdater(`https://${host}/x/y`)).toBe(true);
    expect(fromUpdater("https://example.com/latest.yml")).toBe(false);
    expect(fromUpdater("https://github.com.evil.example/x")).toBe(false);
    expect(fromUpdater("https://evilgithub.com/x")).toBe(false);
    expect(fromUpdater("http://github.com/x")).toBe(false); // plain http is never allowed out
    expect(fromUpdater("wss://github.com/x")).toBe(false);
  });

  it("keeps every request from a page of the window on this PC, GitHub included", () => {
    expect(fromPage("https://github.com/TheLion007/atlas-os/releases")).toBe(false);
    expect(fromPage("https://objects.githubusercontent.com/x")).toBe(false);
    expect(fromPage("https://example.com/")).toBe(false);
    expect(fromPage("http://127.0.0.1:3000/api/graph")).toBe(true);
    expect(fromPage("http://localhost:3000/")).toBe(true);
  });

  it("refuses what is not a URL", () => {
    expect(fromUpdater("not a url")).toBe(false);
  });

  it("looks again every few hours, not every few seconds", () => {
    expect(CHECK_EVERY_MS).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(CHECK_EVERY_MS).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });
});

describe("what went wrong, in a few plain codes", () => {
  const e = (message: string, code?: string) => Object.assign(new Error(message), { code });
  it("tells no connection apart", () => {
    expect(classifyError(e("getaddrinfo ENOTFOUND github.com", "ENOTFOUND"), "check")).toBe(
      "offline",
    );
    expect(classifyError(e("net::ERR_INTERNET_DISCONNECTED"), "check")).toBe("offline");
    expect(classifyError(e("connect ECONNREFUSED"), "check")).toBe("offline");
  });
  it("calls a dropped download an interrupted download", () => {
    expect(classifyError(e("net::ERR_CONNECTION_RESET"), "download")).toBe("interrupted");
    expect(classifyError(e("something odd"), "download")).toBe("interrupted");
  });
  it("tells a missing release, an incomplete file and the rest", () => {
    expect(classifyError(e("Cannot find latest.yml in the latest release"), "check")).toBe(
      "not_found",
    );
    expect(classifyError(e("HttpError: 404 Not Found"), "check")).toBe("not_found");
    expect(classifyError(e("sha512 checksum mismatch"), "download")).toBe("corrupt");
    expect(classifyError(e("something odd"), "check")).toBe("failed");
  });
});
