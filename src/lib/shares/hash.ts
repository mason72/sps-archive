/**
 * Password hashing using Web Crypto API (no extra dependencies, edge-safe).
 *
 * New hashes are PBKDF2-SHA256 with a per-password random salt and an OWASP-
 * recommended work factor — a leaked table can't be brute-forced at SHA-256
 * speeds. Legacy hashes (single salted SHA-256, "salt:hash") still verify;
 * they upgrade whenever the photographer next sets the password.
 */

const PBKDF2_ITERATIONS = 310_000;

/** Hash a plaintext password → "pbkdf2:<iterations>:<salt>:<hash>" */
export async function hashPassword(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(password, saltBytes, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(saltBytes)}:${hash}`;
}

/** Verify a plaintext password against a stored hash (either format). */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (storedHash.startsWith("pbkdf2:")) {
    const [, iterationsStr, saltHex, expectedHash] = storedHash.split(":");
    const iterations = parseInt(iterationsStr, 10);
    if (!iterations || !saltHex || !expectedHash) return false;
    const hash = await pbkdf2Hex(password, fromHex(saltHex), iterations);
    return timingSafeEqualStr(hash, expectedHash);
  }

  // Legacy format: "<salt>:<sha256(salt + password)>"
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return timingSafeEqualStr(toHex(new Uint8Array(hashBuffer)), expectedHash);
}

async function pbkdf2Hex(
  password: string,
  saltBytes: Uint8Array,
  iterations: number
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes as BufferSource, iterations },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time string comparison (edge-runtime safe — no node:crypto).
 * Comparing with === short-circuits on the first differing character, which
 * leaks match-prefix length as a timing side channel.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
