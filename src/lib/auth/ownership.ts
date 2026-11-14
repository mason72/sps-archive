import type { createServiceClient } from "@/lib/supabase/server";
import { idChunks } from "@/lib/supabase/paged";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The subset of `imageIds` whose photo belongs to `userId` (the photo's event
 * is that user's). THE one image-ownership gate (pilot audit, 2026-11-14).
 *
 * Why it exists: `getAuthUser()` hands routes the SERVICE client, which skips
 * row-level security, so any id a request names must be checked by the code.
 * Before this, a section link, a selection share and a cover id each accepted
 * another account's photo ids, and the readers behind them (editor, recap,
 * mosaic covers) then served those photos as the attacker's own.
 *
 * Why OWNER and not EVENT: cross-event membership is a feature. The TDP
 * Website and Work galleries hold photos that live in other events of the
 * same account (605 links on 2026-11-14, every one same-owner, 0 cross-owner),
 * and two live selection shares on TDP Website carry TDP Work photo ids. An
 * event-scoped gate would have broken all of them.
 *
 * Fails CLOSED: a read error throws, never returns "none owned" or "all
 * owned". Callers that only READ may catch and drop the photos instead.
 */
export async function ownedImageIds(
  supabase: ServiceClient,
  userId: string,
  imageIds: readonly string[]
): Promise<Set<string>> {
  const owned = new Set<string>();
  const unique = [...new Set(imageIds.filter((id) => typeof id === "string" && id))];
  for (const chunk of idChunks(unique)) {
    const { data, error } = await supabase
      .from("images")
      .select("id, events!event_id!inner(user_id)")
      .in("id", chunk)
      .eq("events.user_id", userId);
    if (error) throw error;
    for (const row of data ?? []) owned.add(row.id as string);
  }
  return owned;
}

/** The owner of an event, or null when the event does not exist. Throws on a read error. */
export async function eventOwnerId(
  supabase: ServiceClient,
  eventId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data?.user_id as string | undefined) ?? null;
}
