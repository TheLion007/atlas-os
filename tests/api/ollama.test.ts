import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as status } from "@/app/api/ollama/status/route";
import { POST as chatRoute } from "@/app/api/ollama/chat/route";
import { POST as warmupRoute } from "@/app/api/ollama/warmup/route";
import { isLocalRequest } from "@/server/ollama";

const local = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers: { host: "127.0.0.1:3000", ...init?.headers },
  });

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) =>
  vi.stubGlobal("fetch", vi.fn(impl));

describe("the local bridge to Ollama", () => {
  it("only serves this PC", () => {
    expect(isLocalRequest(local("/"))).toBe(true);
    expect(
      isLocalRequest(
        new Request("http://localhost:3000/", { headers: { host: "localhost:3000" } }),
      ),
    ).toBe(true);
    expect(
      isLocalRequest(
        new Request("https://atlas.example.com/", { headers: { host: "atlas.example.com" } }),
      ),
    ).toBe(false);
    expect(isLocalRequest(local("/", { headers: { origin: "https://evil.example" } }))).toBe(false);
  });

  it("refuses a remote caller", async () => {
    const res = await status(
      new Request("https://atlas.example.com/api/ollama/status", {
        headers: { host: "atlas.example.com" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("lists the installed models", async () => {
    stubFetch(async () =>
      Response.json({ models: [{ name: "llama3.2:3b", size: 2_000_000_000 }, { nope: 1 }] }),
    );
    const body = await (await status(local("/api/ollama/status"))).json();
    expect(body).toEqual({
      reachable: true,
      models: [{ name: "llama3.2:3b", sizeBytes: 2_000_000_000 }],
    });
  });

  it("calls Ollama on this PC and nowhere else", async () => {
    const spy = vi.fn(async () => Response.json({ models: [] }));
    vi.stubGlobal("fetch", spy);
    await status(local("/api/ollama/status"));
    expect(String((spy.mock.calls[0] as unknown[])[0])).toMatch(/^http:\/\/127\.0\.0\.1:11434\//);
  });

  it("says Ollama is off, instead of failing, when nothing answers", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const body = await (await status(local("/api/ollama/status"))).json();
    expect(body).toEqual({ reachable: false, models: [] });
  });

  const ask = (model = "llama3.2:3b") =>
    chatRoute(
      local("/api/ollama/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Salut" }] }),
      }),
    );

  it("returns the model's answer", async () => {
    stubFetch(async () =>
      Response.json({ message: { role: "assistant", content: " Bonjour ! " } }),
    );
    expect(await (await ask()).json()).toEqual({ answer: "Bonjour !" });
  });

  it("names each failure: Ollama closed, model removed, too slow, unreadable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    let res = await ask();
    expect([res.status, (await res.json()).error.code]).toEqual([503, "unreachable"]);

    stubFetch(async () => new Response("model not found", { status: 404 }));
    res = await ask("gone:1b");
    expect([res.status, (await res.json()).error.code]).toEqual([404, "model_missing"]);

    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    res = await ask();
    expect([res.status, (await res.json()).error.code]).toEqual([504, "timeout"]);

    stubFetch(async () => Response.json({ message: { content: "" } }));
    res = await ask();
    expect([res.status, (await res.json()).error.code]).toEqual([502, "bad_response"]);
  });

  it("warms a model up with an empty request that keeps it in memory", async () => {
    const spy = vi.fn(async () => Response.json({ done: true }));
    vi.stubGlobal("fetch", spy);
    const res = await warmupRoute(
      local("/api/ollama/warmup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "llama3.2:3b" }),
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/generate");
    expect(JSON.parse(String(init.body))).toEqual({ model: "llama3.2:3b", keep_alive: "15m" });
    stubFetch(async () => new Response("nope", { status: 404 }));
    const gone = await warmupRoute(
      local("/api/ollama/warmup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gone:1b" }),
      }),
    );
    expect(gone.status).toBe(404);
  });

  it("rejects a malformed question", async () => {
    const res = await chatRoute(
      local("/api/ollama/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
  });
});
