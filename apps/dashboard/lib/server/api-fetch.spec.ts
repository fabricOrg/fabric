import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Never resolves on its own — it settles only when the passed signal aborts. */
function hangingFetch(): typeof fetch {
  return vi.fn((_input: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
}

describe("apiFetch", () => {
  it("answers its own deadline with a 504 upstream_timeout envelope", async () => {
    globalThis.fetch = hangingFetch();

    const response = await apiFetch("https://api.example.com/v1/wallet", {}, 5);

    // A rejection here would reach the route handler as a bare DOMException and land as a generic
    // 500 the browser cannot branch on — and would skip the `read ?? refresh` session fallback,
    // which only runs when a resolver RETURNS rather than throws.
    expect(response.status).toBe(504);
    expect(response.ok).toBe(false);
    const body = (await response.json()) as {
      error: { type: string; code: string; message: string };
    };
    expect(body.error.code).toBe("upstream_timeout");
    expect(body.error.type).toBe("api_error");
    expect(body.error.message).toMatch(/may still have completed/);
  });

  it("still rejects when the CALLER aborts", async () => {
    globalThis.fetch = hangingFetch();
    const controller = new AbortController();
    const pending = apiFetch(
      "https://api.example.com/v1/wallet",
      { signal: controller.signal },
      60_000,
    );
    controller.abort();

    // Only our deadline becomes a response. A caller's own cancellation is not an upstream failure.
    await expect(pending).rejects.toThrow();
  });

  it("passes a successful response through untouched", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ data: { ok: true }, request_id: "req_1" }),
    ) as unknown as typeof fetch;

    const response = await apiFetch("https://api.example.com/v1/wallet");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ok: true },
      request_id: "req_1",
    });
  });
});
