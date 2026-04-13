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
});
