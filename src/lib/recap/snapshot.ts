import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getSpsToken } from "@/lib/sps-integration/connection";
import { readSpsEventId } from "@/lib/sps-integration/event-link";
import { fetchRecap, SpsPullError } from "@/lib/sps-integration/pull-client";
import { normalizeRecap } from "./normalize";
import type { SpsRecap } from "./types";

type DB = SupabaseClient<Database>;

export type SnapshotOutcome =
  | { kind: "stored"; recap: SpsRecap }
  /** The event is not linked to SPS, or the photographer has no connection. */
  | { kind: "not-linked" }
  /** SPS no longer has the event (its ~3-month retention). The old snapshot stays. */
  | { kind: "gone" }
  /** Anything else; the old snapshot stays and the message is safe to show. */
  | { kind: "failed"; message: string };

/**
 * Fetch the delivery recap from SPS and store it on the event.
 *
 * Called at the end of a pull (the numbers are complete once the event has
 * wrapped) and from the share page's "Refresh numbers". A refresh that fails
 * never clears what is already stored: SPS deletes events after about three
 * months, and from then on the snapshot is the only copy there is.
 */
export async function snapshotRecap(
  supabase: DB,
  eventId: string
): Promise<SnapshotOutcome> {
  const { data: event, error } = await supabase
    .from("events")
    .select("id, user_id, settings")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return { kind: "failed", message: "Event not found." };

  const spsEventId = readSpsEventId(event.settings as Record<string, unknown> | null);
  if (!spsEventId) return { kind: "not-linked" };

  const token = await getSpsToken(supabase, event.user_id);
  if (!token) return { kind: "not-linked" };

  let raw: unknown;
  try {
    raw = await fetchRecap(token, spsEventId);
  } catch (err) {
    if (err instanceof SpsPullError && err.kind === "not-found") return { kind: "gone" };
    // SpsPullError messages never carry the token (pull-client's rule 3), and
    // a generic Error's message is the fetch layer's, so both are safe here.
    return {
      kind: "failed",
      message: err instanceof Error ? err.message : "SPS did not answer.",
    };
  }

  const recap = normalizeRecap(raw);
  if (!recap) {
    return { kind: "failed", message: "SPS answered with a recap this version cannot read." };
  }

  const fetchedAt = new Date().toISOString();
  const { error: writeError } = await supabase
    .from("events")
    .update({ recap: recap as unknown as Database["public"]["Tables"]["events"]["Row"]["recap"], recap_fetched_at: fetchedAt })
    .eq("id", eventId);
  if (writeError) throw writeError;

  return { kind: "stored", recap };
}
