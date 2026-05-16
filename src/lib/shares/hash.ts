/**
 * Password hashing for share-link gates.
 *
 * Uses PBKDF2-SHA256 with 600,000 iterations (OWASP 2023 recommendation
 * for SHA-256-based KDFs) via Web Crypto. No native deps so it runs in
 * Edge and Node runtimes.
 *
 * Format: `pbkdf2$<iter>$<saltBase64>$<hashBase64>`
 *
 * Legacy format (`<uuidSalt>:<hex64>`) — pre-Phase 0 SHA-256 single-pass
 * — is still verified for compatibility, but the verify path also reports
 * `needsRehash` so the caller can upgrade the stored hash on a successful
 * login. Once all stored hashes have been upgraded the legacy branch can
 * be removed.
 */

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

function bufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64");
}
function base64ToBuffer(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: PBKDF2_HASH,
    },
    baseKey,
    PBKDF2_KEY_LENGTH_BITS
  );
}

/** Constant-time byte comparison. Returns false if lengths differ. */
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Hash a plaintext password — always uses the modern PBKDF2 format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufferToBase64(salt.buffer)}$${bufferToBase64(hash)}`;
}

export interface VerifyResult {
  /** Whether the password matched. */
  valid: boolean;
  /** True when the stored hash is in the legacy format and should be
   *  re-hashed with `hashPassword` after a successful verify. */
  needsRehash: boolean;
}

/** Verify a plaintext password against a stored hash (either format). */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<VerifyResult> {
  if (!storedHash) return { valid: false, needsRehash: false };

  if (storedHash.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 4) return { valid: false, needsRehash: false };
    const iterations = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1) {
      return { valid: false, needsRehash: false };
    }
    const salt = base64ToBuffer(parts[2]);
    const expected = base64ToBuffer(parts[3]);
    const actual = new Uint8Array(await pbkdf2(password, salt, iterations));
    return {
      valid: constantTimeEqualBytes(expected, actual),
      // If iteration count drifts below the current floor, schedule a rehash.
      needsRehash: iterations < PBKDF2_ITERATIONS,
    };
  }

  // Legacy SHA-256 single-pass format (`<uuidSalt>:<hex64>`)
  const colon = storedHash.indexOf(":");
  if (colon === -1) return { valid: false, needsRehash: false };
  const salt = storedHash.slice(0, colon);
  const expectedHex = storedHash.slice(colon + 1);
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(salt + password));
  const actualHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const valid =
    actualHex.length === expectedHex.length &&
    constantTimeEqualBytes(
      new TextEncoder().encode(actualHex),
      new TextEncoder().encode(expectedHex)
    );
  return { valid, needsRehash: valid };
}
