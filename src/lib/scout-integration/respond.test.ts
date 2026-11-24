import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { reportSystemError } from "@/lib/monitoring/report";
import { scoutErrorResponse } from "./respond";
import { ScoutIntegrationError } from "./store";

const FAKE = "FAKE-TOKEN-0123456789abcdef";
const leaky = `remux failed: https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/c.mp4?token=${FAKE}`;

describe("scoutErrorResponse", () => {
  it("reports and logs an unknown error with every signed URL scrubbed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await scoutErrorResponse(new Error(leaky), "scout.test");
    expect(res.status).toBe(500);
    const reported = vi.mocked(reportSystemError).mock.calls.at(-1)?.[1] as Error;
    expect(reported.message).toContain("c.mp4?<redacted>");
    expect(reported.message).not.toContain(FAKE);
    expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE);
    log.mockRestore();
  });

  it("scrubs a known error's message in both the report and the response", async () => {
    const res = await scoutErrorResponse(new ScoutIntegrationError(leaky, 502), "scout.test");
    const body = await res.json();
    expect(body.error).not.toContain(FAKE);
    const reported = vi.mocked(reportSystemError).mock.calls.at(-1)?.[1] as Error;
    expect(reported.message).not.toContain(FAKE);
  });
});
