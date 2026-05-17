/**
 * Gallery session tokens.
 *
 * After a viewer authenticates a password-protected gallery, the verify
 * route issues a signed cookie that proves the holder cleared the gate.
 * The token binds slug + shareId + an absolute expiry time under an HMAC
 * keyed by GALLERY_SESSION_SECRET so it cannot be forged by anyone
 * without the server secret.
 *
 * Format: `<expEpochSeconds>.<base64UrlHmacSha256>`
 *
 * Replaces the legacy cookie format (raw share.id), which was a bearer
 * token equal to a value exposed by the old anon-readable shares RLS
 * policy + multiple API responses. Anyone who saw the share.id once
 * could plant the cookie and bypass the gate.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  // We don't want to silently fall back to an empty/weak secret in prod —
  // the secret is the entire security of the cookie. Throw at first use if
  // missing so the failure is loud during boot.
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
  const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  return Buffer.from(pad, "base64");
}

function signPayload(slug: string, shareId: string, exp: number): string {
  const secret = getSecret();
  const payload = `${slug}.${shareId}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return base64UrlEncode(sig);
}

/** Build a cookie value that authenticates a viewer for a given slug + share. */
export function createGallerySession(
  slug: string,
  shareId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signPayload(slug, shareId, exp);
  return { value: `${exp}.${sig}`, maxAge: ttlSeconds };
}

/** Verify a cookie value against the given slug + shareId. */
export function verifyGallerySession(
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

  const expectedSig = signPayload(slug, shareId, exp);
  const a = base64UrlDecode(providedSig);
  const b = base64UrlDecode(expectedSig);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Cookie name used for gallery session tokens. Distinct from the legacy
 *  `gallery_auth_${slug}` so the two formats can coexist while we migrate. */
export function gallerySessionCookieName(slug: string): string {
  return `pt-gs-${slug}`;
}
