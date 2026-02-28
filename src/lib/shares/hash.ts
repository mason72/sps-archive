/**
 * Password hashing using Web Crypto API (no extra dependencies).
 * Uses SHA-256 with a random salt for share link passwords.
 */

/** Hash a plaintext password → "salt:hash" string */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${salt}:${hash}`;
}

/** Verify a plaintext password against a "salt:hash" string */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hash === expectedHash;
}
