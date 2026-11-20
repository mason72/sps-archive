import { describe, it, expect, vi } from "vitest";
import {
  HttpStatusError,
  isTransientResult,
  isTransientThrow,
  retryResult,
  retryThrown,
} from "./retry";

const noWait = { delays: [0, 0], sleep: async () => {} };

/** The exact shape undici throws: TypeError("fetch failed") with the socket error on .cause. */
function undiciFailure(code: string) {
  const cause = Object.assign(new Error("Connect Timeout Error"), {
    name: "ConnectTimeoutError",
    code,
  });
  return new TypeError("fetch failed", { cause });
}

/** The exact shape postgrest-js RETURNS (never throws) on a network failure. */
const dbNetworkFailure = {
  data: null,
  error: { message: "TypeError: fetch failed", details: "Caused by: ConnectTimeoutError", hint: "", code: "" },
  status: 0,
};

describe("isTransientThrow", () => {
  it("retries what is the network", () => {
    expect(isTransientThrow(undiciFailure("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
    expect(isTransientThrow(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientThrow(new TypeError("terminated"))).toBe(true);
    expect(isTransientThrow(Object.assign(new Error("read"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientThrow(new HttpStatusError(500, "source fetch 500"))).toBe(true);
    expect(isTransientThrow(new HttpStatusError(503, "source fetch 503"))).toBe(true);
    expect(isTransientThrow(new HttpStatusError(429, "source fetch 429"))).toBe(true);
  });

  it("does not retry what is the data, or our own ceiling", () => {
    expect(isTransientThrow(new HttpStatusError(403, "source fetch 403"))).toBe(false);
    expect(isTransientThrow(new HttpStatusError(404, "source fetch 404"))).toBe(false);
    expect(isTransientThrow(new Error("source too small"))).toBe(false);
    expect(isTransientThrow(new TypeError("Cannot read properties of undefined"))).toBe(false);
    // AbortSignal.timeout: the two-minute download ceiling is deliberate.
    expect(isTransientThrow(new DOMException("The operation timed out.", "TimeoutError"))).toBe(false);
    // A supabase-js error object is not thrown, and not an Error.
    expect(isTransientThrow(dbNetworkFailure.error)).toBe(false);
    expect(isTransientThrow("fetch failed")).toBe(false);
  });
});

describe("isTransientResult", () => {
  it("retries status 0 and the gateway codes", () => {
    expect(isTransientResult(dbNetworkFailure)).toBe(true);
    for (const status of [502, 503, 504]) {
      expect(isTransientResult({ error: { message: "Bad gateway" }, status })).toBe(true);
    }
  });

  it("does not retry success, constraint violations or statement timeouts", () => {
    expect(isTransientResult({ error: null, status: 0 })).toBe(false);
    expect(isTransientResult({ error: null, status: 201 })).toBe(false);
    expect(isTransientResult({ error: { code: "23505" }, status: 409 })).toBe(false);
    expect(isTransientResult({ error: { code: "57014" }, status: 500 })).toBe(false);
    expect(isTransientResult({ error: { code: "PGRST116" }, status: 406 })).toBe(false);
  });
});

describe("retryThrown", () => {
  it("returns the first success after transient failures", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(undiciFailure("UND_ERR_CONNECT_TIMEOUT"))
      .mockRejectedValueOnce(new HttpStatusError(500, "source fetch 500"))
      .mockResolvedValueOnce("bytes");
    await expect(retryThrown(op, noWait)).resolves.toBe("bytes");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("gives up after three tries and throws the last error", async () => {
    const op = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(retryThrown(op, noWait)).rejects.toThrow("fetch failed");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient error", async () => {
    const op = vi.fn(async () => {
      throw new HttpStatusError(404, "source fetch 404");
    });
    await expect(retryThrown(op, noWait)).rejects.toThrow("source fetch 404");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("waits between tries", async () => {
    const sleep = vi.fn(async () => {});
    const op = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(1);
    await retryThrown(op, { delays: [1000, 3000], sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    // ±25% jitter around the first delay.
    const waited = (sleep.mock.calls[0] as unknown as [number])[0];
    expect(waited).toBeGreaterThanOrEqual(750);
    expect(waited).toBeLessThanOrEqual(1250);
  });
});

describe("retryResult", () => {
  it("repeats a network failure and returns the success", async () => {
    const ok = { data: null, error: null, status: 204 };
    const op = vi
      .fn<() => Promise<typeof ok | typeof dbNetworkFailure>>()
      .mockResolvedValueOnce(dbNetworkFailure)
      .mockResolvedValueOnce(ok);
    await expect(retryResult(op, noWait)).resolves.toBe(ok);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("returns a data error at once, without repeating the write", async () => {
    const conflict = { data: null, error: { code: "23505", message: "duplicate key" }, status: 409 };
    const op = vi.fn(async () => conflict);
    await expect(retryResult(op, noWait)).resolves.toBe(conflict);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("returns the last failure after three tries", async () => {
    const op = vi.fn(async () => dbNetworkFailure);
    await expect(retryResult(op, noWait)).resolves.toBe(dbNetworkFailure);
    expect(op).toHaveBeenCalledTimes(3);
  });
});
