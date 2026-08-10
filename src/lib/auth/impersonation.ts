/**
 * Admin "act as" — Mason's personal admin account assuming the shared team
 * account's identity for content work, without sharing the team password.
 *
 * Mechanics: an httpOnly cookie carrying `<uid>:<email>` plus an HMAC over it
 * (GALLERY_SESSION_SECRET). getAuthUser() honors it ONLY when the REAL
 * session's profile has is_admin — a stolen or replayed cookie on a
 * non-admin session is inert, and demoting an admin kills their act-as
 * instantly. Ops access (requireAdmin) always checks the REAL identity, so
 * an admin acting as the team account keeps /ops and the team account never
 * gains it.
 *
 * Attribution note: usage metering and activity logs record the EFFECTIVE
 * user while acting — content work done in the team account's name is the
 * team account's usage, which is exactly what the cost ledger should say.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const ACT_AS_COOKIE = "pt-act-as";

function secret(): string | null {
  return process.env.GALLERY_SESSION_SECRET || null;
}

function sign(payload: string): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update(payload).digest("hex");
}

/** Cookie value for acting as `uid`/`email`, or null if unsigned (no secret). */
export function encodeActAs(uid: string, email: string): string | null {
  const payload = `${uid}:${email}`;
  const sig = sign(payload);
  return sig ? `${Buffer.from(payload).toString("base64url")}.${sig}` : null;
}

/** Verified {uid, email} from a cookie value, or null on any mismatch. */
export function decodeActAs(
  value: string | undefined | null
): { uid: string; email: string } | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(value.slice(0, dot), "base64url").toString();
  } catch {
    return null;
  }
  const expected = sign(payload);
  const given = value.slice(dot + 1);
  if (!expected || expected.length !== given.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  const sep = payload.indexOf(":");
  if (sep < 0) return null;
  return { uid: payload.slice(0, sep), email: payload.slice(sep + 1) };
}
