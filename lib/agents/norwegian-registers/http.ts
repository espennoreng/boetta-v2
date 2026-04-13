// lib/agents/norwegian-registers/http.ts
import type { Fetcher } from "./types";

export class HttpError extends Error {
  constructor(public status: number, public url: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: Fetcher;
}

export async function fetchJson<T>(
  url: string,
  { timeoutMs = 5000, retries = 1, fetchImpl = fetch }: FetchOptions = {},
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new HttpError(res.status, url, `${res.status} ${res.statusText}`);
        if (res.status >= 500 && attempt < retries) continue;
        throw lastError;
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) continue;
      throw err;
    }
  }
  throw lastError;
}
