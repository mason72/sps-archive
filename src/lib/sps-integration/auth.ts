import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * SPS Integration Authentication
 *
 * Supports two auth methods for inter-service communication:
 *
 * 1. **JWT Auth** (user-initiated actions):
 *    Header: `Authorization: Bearer <supabase-jwt>`
 *    SPS passes the user's Supabase JWT. Archive validates it
 *    and extracts the user ID for scoped operations.
 *
 * 2. **API Key Auth** (service-to-service):
 *    Header: `X-SPS-Key: <shared-secret>`
 *    For background jobs where no user session exists.
 *    Requires `userId` in the request body.
 */

export type SPSAuthResult =
  | { authenticated: true; userId: string; method: "jwt" | "api-key" }
  | { authenticated: false; error: string };

/**
 * Authenticate an SPS integration request.
 *
 * Tries JWT first, then falls back to API key.
 * Returns the verified user ID on success.
 */
export async function authenticateSPSRequest(
  request: NextRequest,
  bodyUserId?: string
): Promise<SPSAuthResult> {
  // ─── Method 1: Supabase JWT ───
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return validateJWT(token);
  }

  // ─── Method 2: Shared API Key ───
  const apiKey = request.headers.get("x-sps-key");
  const configuredKey = process.env.SPS_INTEGRATION_KEY;

  if (apiKey && configuredKey && apiKey === configuredKey) {
    if (!bodyUserId) {
      return {
        authenticated: false,
        error: "API key auth requires userId in request body",
      };
    }
    return { authenticated: true, userId: bodyUserId, method: "api-key" };
  }

  if (apiKey && !configuredKey) {
    return {
      authenticated: false,
      error: "SPS_INTEGRATION_KEY not configured on server",
    };
  }

  return {
    authenticated: false,
    error: "Missing authentication. Provide Authorization: Bearer <jwt> or X-SPS-Key header.",
  };
}

/**
 * Validate a Supabase JWT and extract the user ID.
 */
async function validateJWT(token: string): Promise<SPSAuthResult> {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { authenticated: false, error: "Invalid or expired JWT" };
    }

    return { authenticated: true, userId: user.id, method: "jwt" };
  } catch {
    return { authenticated: false, error: "JWT validation failed" };
  }
}
