import { createHmac } from "node:crypto";
import { timingSafeEqualStr } from "./hash";

/**
 * Short-lived bulk-download tokens.
 *
 * After a guest passes verify-pin, the server hands back an HMAC-signed
 * token scoped to that share. Bulk download URLs carry the TOKEN instead of
 * the raw PIN — the PIN was landing in access logs on every request (audit
 * #3), while a leaked token is worthless after expiry and never reveals the
 * PIN itself.
 *
 * Format: "<expiresAtSec>.<hmacSha256UrlB64>", signed over "<shareId>.<exp>"
 * with a key derived from SUPABASE_SERVICE_ROLE_KEY (always present
 * server-side; derivation keeps the raw service key out of any HMAC reuse).
 */

const TOKEN_CONTEXT = "pixeltrunk-download-token-v1";

function signingKey(secret?: string): Buffer {
  const base = secret ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("download-token: no signing secret available");
  return createHmac("sha256", base).update(TOKEN_CONTEXT).digest();
}

function sign(shareId: string, expiresAtSec: number, secret?: string): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${shareId}.${expiresAtSec}`)
    .digest("base64url");
}

/** Create a token for one share, valid ttlSec from now (default 4h). */
export function createDownloadToken(
  shareId: string,
  ttlSec = 4 * 3600,
  secret?: string
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${exp}.${sign(shareId, exp, secret)}`;
}

/** True when the token is well-formed, unexpired, and signed for this share. */
export function verifyDownloadToken(
  token: string,
  shareId: string,
  secret?: string
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  return timingSafeEqualStr(token.slice(dot + 1), sign(shareId, exp, secret));
}
