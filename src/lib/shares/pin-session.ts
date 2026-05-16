/**
 * Gallery PIN cookies.
 *
 * Once a viewer verifies a share's download PIN via /api/gallery/[slug]/verify-pin,
 * we set an HMAC-signed cookie that the download route checks. This lets the
 * PIN stay in a POST body (verify-pin) instead of riding along on download
 * URLs as `?pin=1234`, where it would leak into browser history, server
 * access logs, and Referer headers.
 *
 * Cookie name: `pt-pin-<slug>`. Format mirrors lib/shares/session.ts
 * (`<expSeconds>.<base64UrlSig>`) but is signed independently of the
 * password-gate session so the two states stay decoupled.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 1 day

function getSecret(): string {
  const secret = process.env.GALLERY_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "GALLERY_SESSION_SECRET env var must be set to a random string of at least 32 chars"
    );
  }
  return secret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  return Buffer.from(pad, "base64");
}

function signPin(slug: string, shareId: string, exp: number): string {
  const secret = getSecret();
  // The "pin:" prefix domain-separates this signature from the password
  // session signature so a pin cookie can't be replayed as a session.
  const payload = `pin:${slug}.${shareId}.${exp}`;
  return base64UrlEncode(createHmac("sha256", secret).update(payload).digest());
}

export function createGalleryPin(
  slug: string,
  shareId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signPin(slug, shareId, exp);
  return { value: `${exp}.${sig}`, maxAge: ttlSeconds };
}

export function verifyGalleryPin(
  cookieValue: string | undefined,
  slug: string,
  shareId: string
): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot === -1) return false;
  const exp = Number.parseInt(cookieValue.slice(0, dot), 10);
  const providedSig = cookieValue.slice(dot + 1);
  if (!Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expectedSig = signPin(slug, shareId, exp);
  const a = base64UrlDecode(providedSig);
  const b = base64UrlDecode(expectedSig);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function galleryPinCookieName(slug: string): string {
  return `pt-pin-${slug}`;
}
