import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deadlineFetch } from "./deadline-fetch";

// A REAL local server that accepts and never answers: the timeout is tested
// against a held socket, not a faked promise (rules: fake the server's
// answers, never the plumbing a timeout depends on).
let server: Server;
let url: string;
beforeAll(async () => {
  server = createServer(() => {
    /* never answers */
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("deadlineFetch", () => {
  it("cuts a hung call at the shared deadline, well before the per-call limit", async () => {
    const f = deadlineFetch(Date.now() + 300, { perCallMs: 30_000 });
    const t0 = Date.now();
    await expect(f(url)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
  }, 5_000);

  it("refuses at once when the deadline has already passed", async () => {
    const f = deadlineFetch(Date.now() - 1);
    const t0 = Date.now();
    await expect(f(url)).rejects.toThrow(/deadline passed/);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("a run of slow calls cannot add up past the deadline", async () => {
    const deadline = Date.now() + 600;
    const f = deadlineFetch(deadline, { perCallMs: 400 });
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) await f(url).catch(() => {}); // 4 x 400 ms would be 1.6 s
    expect(Date.now() - t0).toBeLessThan(1_100);
  }, 5_000);
});
