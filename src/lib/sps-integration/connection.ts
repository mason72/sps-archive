/**
 * The stored SimplePhotoShare connection token — one row per photographer.
 *
 * Per user, NOT an env var (decided 2026-08-11, spec `e3282fd`): SPS mints per
 * `user_id`, so a single env var would pin this whole install to one SPS
 * account and silently break the second photographer who connects.
 *
 * The asymmetry that governs how this is held: SPS only ever *verifies* the
 * token, so it stores a sha256 and can afford to. Pixeltrunk must *present* it
 * on every request, so it has to retain the plaintext. That makes this file the
 * one place in the codebase that reads a live third-party credential, and the
 * rules are:
 *
 *  - `sps_connections` is service-role only (RLS on, no policies).
 *  - The plaintext is NEVER returned to the browser. Routes return
 *    `SpsConnectionStatus`, which carries a masked prefix and nothing else.
 *  - It never reaches a log line, an error body, a `system_errors` detail blob,
 *    or a process argument.
 *  - Disconnecting DELETES the row. A revoked credential we still hold is worse
 *    than a lost `last_pull_at`, which is why this doesn't tombstone the way
 *    SPS's own side does.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { listSpsEvents, SpsPullError } from "./pull-client";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** What the browser is allowed to know about the connection. */
export interface SpsConnectionStatus {
  connected: boolean;
  /** e.g. `spsa_AwOrxqN…` — enough to identify which key is installed. */
  tokenPrefix: string | null;
  connectedAt: string | null;
  lastPullAt: string | null;
}

const DISCONNECTED: SpsConnectionStatus = {
  connected: false,
  tokenPrefix: null,
  connectedAt: null,
  lastPullAt: null,
};

/** SPS tokens look like `spsa_<base64url>`. */
export function looksLikeSpsToken(value: string): boolean {
  return /^spsa_[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

/**
 * The display form. Shows enough to distinguish two keys and never enough to
 * use one.
 *
 * 12 characters because that is exactly what SPS stores as its own
 * `token_prefix` (`mintArchiveToken`, spsv2 `apps/admin/src/lib/archive.ts`).
 * Matching it means both panels print the same prefix for the same key, so a
 * photographer comparing the two screens can tell at a glance whether the key
 * installed here is the key SPS last minted.
 */
export const TOKEN_PREFIX_LENGTH = 12;

export function maskToken(token: string): string {
  return `${token.trim().slice(0, TOKEN_PREFIX_LENGTH)}…`;
}

/**
 * The plaintext, for server-side use only.
 *
 * Returns null when the photographer hasn't connected — callers must treat that
 * as "the integration is not set up", never as an error to report.
 */
export async function getSpsToken(
  supabase: SupabaseDB,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sps_connections")
    .select("token")
    .eq("user_id", userId)
    .maybeSingle();

  // A Supabase error is a return value, not a throw: `data?.token ?? null` on
  // its own would report "not connected" for a broken query, and the
  // photographer would be told to re-paste a token that is already correct.
  if (error) throw error;

  return data?.token ?? null;
}

export async function getSpsConnectionStatus(
  supabase: SupabaseDB,
  userId: string
): Promise<SpsConnectionStatus> {
  const { data, error } = await supabase
    .from("sps_connections")
    .select("token_prefix, connected_at, last_pull_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DISCONNECTED;

  return {
    connected: true,
    tokenPrefix: data.token_prefix,
    connectedAt: data.connected_at,
    lastPullAt: data.last_pull_at,
  };
}

export type SaveTokenResult =
  | { ok: true; status: SpsConnectionStatus; eventCount: number }
  | { ok: false; reason: "malformed" | "rejected" | "unreachable"; message: string };

/**
 * Store a pasted token — but only after proving it works.
 *
 * SPS displays the token exactly once, so a truncated paste that only surfaces
 * at the first import reads as "the integration is broken" rather than "the
 * paste was short". Validating here, and reporting how many events came back,
 * makes a successful save mean something.
 */
export async function saveSpsToken(
  supabase: SupabaseDB,
  userId: string,
  rawToken: string
): Promise<SaveTokenResult> {
  const token = rawToken.trim();

  if (!looksLikeSpsToken(token)) {
    return {
      ok: false,
      reason: "malformed",
      message:
        "That doesn't look like an SPS token. It starts with spsa_ and is shown once when you connect in SPS.",
    };
  }

  let eventCount: number;
  try {
    eventCount = (await listSpsEvents(token)).length;
  } catch (err) {
    if (err instanceof SpsPullError && err.kind === "unauthorized") {
      return {
        ok: false,
        reason: "rejected",
        message:
          "SPS rejected that token. Mint a fresh one in SPS (Settings → Pixeltrunk) — re-minting is free and invalidates the old key.",
      };
    }
    return {
      ok: false,
      reason: "unreachable",
      message:
        err instanceof SpsPullError
          ? err.message
          : "Could not reach SPS to check the token.",
    };
  }

  const connectedAt = new Date().toISOString();
  const { error } = await supabase.from("sps_connections").upsert(
    {
      user_id: userId,
      token,
      token_prefix: maskToken(token),
      connected_at: connectedAt,
      // A re-paste is a NEW credential; whatever the old one had reached says
      // nothing about this one.
      last_pull_at: null,
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;

  return {
    ok: true,
    eventCount,
    status: {
      connected: true,
      tokenPrefix: maskToken(token),
      connectedAt,
      lastPullAt: null,
    },
  };
}

export async function deleteSpsConnection(
  supabase: SupabaseDB,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("sps_connections")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

/** Stamped after a pull actually moves bytes, so "connected but never used" shows. */
export async function markSpsPullActivity(
  supabase: SupabaseDB,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("sps_connections")
    .update({ last_pull_at: new Date().toISOString() })
    .eq("user_id", userId);
  // Non-fatal by nature — it is a timestamp, not the import.
  if (error) console.error("SPS connection last_pull_at update failed:", error);
}
