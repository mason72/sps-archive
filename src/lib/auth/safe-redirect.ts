/**
 * Validate that a redirect path is safe (same-origin, relative).
 *
 * Returns the path unchanged when it looks like a relative URL we control,
 * otherwise returns `fallback`. Rejects:
 *   - Absolute URLs ("https://evil.com/foo")
 *   - Protocol-relative URLs ("//evil.com/foo")
 *   - Backslash-prefixed paths ("/\\evil.com") that some browsers normalize
 *     to a different host
 *   - Empty/falsy inputs
 *
 * Use this anywhere we follow a user-supplied redirect/next URL so we can't
 * be turned into an open redirect that phishes legitimate users.
 */
export function safeRedirect(
  candidate: string | null | undefined,
  fallback: string = "/"
): string {
  if (!candidate || typeof candidate !== "string") return fallback;
  if (!candidate.startsWith("/")) return fallback;
  // Reject protocol-relative ("//host") and backslash-escaped variants
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  return candidate;
}
