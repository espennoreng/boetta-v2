import { describe, it, expect } from "bun:test";
import { fetchJson, HttpError } from "./http";

describe("fetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as unknown as typeof fetch;
    const result = await fetchJson<{ hello: string }>("https://x", {
      fetchImpl: fakeFetch,
    });
    expect(result.hello).toBe("world");
  });

  it("throws HttpError on non-2xx", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchJson("https://x", { fetchImpl: fakeFetch, retries: 0 }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("retries once on 5xx before giving up", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("err", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(
      fetchJson("https://x", { fetchImpl: fakeFetch, retries: 1 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(2);
  });

  it("does NOT retry on 4xx", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("bad input", { status: 400 });
    }) as unknown as typeof fetch;
    await expect(
      fetchJson("https://x", { fetchImpl: fakeFetch, retries: 3 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });

  it("includes response body in HttpError message", async () => {
    const fakeFetch = (async () =>
      new Response("missing field: gnr", { status: 400 })) as unknown as typeof fetch;
    try {
      await fetchJson("https://x", { fetchImpl: fakeFetch, retries: 0 });
      throw new Error("expected HttpError");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).message).toContain("missing field: gnr");
    }
  });
});
