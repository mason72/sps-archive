import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  needsStream,
  isStreamConfigured,
  streamHlsUrl,
  streamIframeUrl,
} from "./client";

describe("needsStream", () => {
  it("keeps short muted clips on the R2 lane", () => {
    expect(needsStream({ durationSeconds: 12, hasAudio: false })).toBe(false);
    expect(needsStream({ durationSeconds: 60, hasAudio: false })).toBe(false);
    expect(needsStream({ durationSeconds: 30, hasAudio: null })).toBe(false);
  });

  it("sends long videos to Stream", () => {
    expect(needsStream({ durationSeconds: 61, hasAudio: false })).toBe(true);
    expect(needsStream({ durationSeconds: 180, hasAudio: null })).toBe(true);
  });

  it("sends sound-on videos to Stream even when short", () => {
    expect(needsStream({ durationSeconds: 10, hasAudio: true })).toBe(true);
  });

  it("treats unknown duration as short (the probe sets it before publish)", () => {
    expect(needsStream({ durationSeconds: null, hasAudio: false })).toBe(false);
  });
});

describe("stream URLs + configuration", () => {
  const saved = {
    token: process.env.CLOUDFLARE_STREAM_API_TOKEN,
    code: process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    r2Account: process.env.R2_ACCOUNT_ID,
  };

  beforeEach(() => {
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "tok";
    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = "abc123";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
  });

  afterEach(() => {
    process.env.CLOUDFLARE_STREAM_API_TOKEN = saved.token;
    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = saved.code;
    process.env.CLOUDFLARE_ACCOUNT_ID = saved.account;
    process.env.R2_ACCOUNT_ID = saved.r2Account;
  });

  it("builds the HLS manifest and iframe URLs from the customer code", () => {
    expect(streamHlsUrl("uid-1")).toBe(
      "https://customer-abc123.cloudflarestream.com/uid-1/manifest/video.m3u8"
    );
    expect(streamIframeUrl("uid-1")).toBe(
      "https://customer-abc123.cloudflarestream.com/uid-1/iframe"
    );
  });

  it("is configured only with token + account + customer code", () => {
    expect(isStreamConfigured()).toBe(true);

    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = "";
    expect(isStreamConfigured()).toBe(false);
  });

  it("falls back to R2_ACCOUNT_ID for the account (same Cloudflare account)", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "";
    process.env.R2_ACCOUNT_ID = "r2acct";
    expect(isStreamConfigured()).toBe(true);
  });
});
