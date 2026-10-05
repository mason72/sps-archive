/**
 * ONE path from an identity suggestion to a decision.
 *
 * Lived inside the API route until 2026-10-04, when the engine started
 * confirming its own sure matches (see AUTO_CONFIDENCE in
 * identity-suggestions.ts). The scan and the human's click now share this
 * file, because a second implementation of "confirm" would be a second place
 * for the crew-vs-guest rule to be got wrong, and that rule (crew identity is
 * a LINK, never persons.name) is the one that must never bend.
 *
 * Every decision records WHO made it (`decided_by`). Auto decisions stay
 * unreviewed until a person looks at them; `undoAutoDecision` is the way back
 * and it un-teaches as well as un-names.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { reportSystemError } from "@/lib/monitoring/report";

import { NON_PERSON_GALLERIES } from "./index-people";

export type SupabaseDB = ReturnType<typeof createServiceClient>;
export type DecidedBy = "human" | "auto";

export type Decision = {
  status: string;
  name?: string | null;
  crew?: boolean;
  existingName?: string | null;
  error?: string;
  /** Rides along so a bulk caller can teach once per event. */
  eventId?: string | null;
};

/**
 * One suggestion, decided.
 *
 * `teach` is deferred by bulk callers and by the scan:
 * refresh_person_reference_centroids is per EVENT, so running it once per
 * suggestion would repeat the same expensive rebuild 192 times and blow the
 * statement budget (lesson 93). They run it once per distinct event after the
 * writes land.
 */
export async function decideOne(
  supabase: SupabaseDB,
  userId: string,
  id: string,
  action: "confirm" | "reject",
  opts: { teach: boolean; decidedBy: DecidedBy }
): Promise<Decision> {
  const now = new Date().toISOString();
  const stamp = { decided_at: now, decided_by: opts.decidedBy };

  const { data: suggestion } = await supabase
    .from("person_identity_suggestions")
    .select("id, user_id, person_id, event_id, kind, crew_id, suggested_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!suggestion || suggestion.user_id !== userId) return { status: "not_found", error: "Not found" };
  if (suggestion.status !== "pending") return { status: "already_decided", error: "Already decided" };

  const { data: person } = await supabase
    .from("persons")
    .select("id, name, rejected_names")
    .eq("id", suggestion.person_id)
    .maybeSingle();
  if (!person) return { status: "gone", error: "Cluster is gone" };

  // Crew confirm is a LINK, never a name — crew names must not touch
  // persons.name (guest identity space; the standing crew-faces invariant).
  // confirmCrewPerson also teaches: the cluster's representative face joins
  // the crew's reference set.
  if (action === "confirm" && suggestion.kind === "crew" && suggestion.crew_id) {
    const { confirmCrewPerson } = await import("@/lib/crew-faces/match");
    const linked = await confirmCrewPerson(supabase, {
      userId,
      crewId: suggestion.crew_id,
      personId: suggestion.person_id,
      confirmedBy: opts.decidedBy,
    });
    if (!linked.ok) throw new Error(linked.error ?? "Crew link failed");
    // A junk label on a crew cluster dies WITH the confirm: the name came
    // from random filenames ("Marriott Green" on Christie's faces), and
    // clearing it into rejected_names means the consensus namer can never
    // re-apply it. Crew identity lives in the link, never in persons.name.
    if (person.name) {
      const rejected = new Set(person.rejected_names ?? []);
      rejected.add(person.name);
      const { error: clearErr } = await supabase
        .from("persons")
        .update({ name: null, rejected_names: [...rejected] })
        .eq("id", suggestion.person_id);
      if (clearErr) throw clearErr;
    }
    const { error: statusErr } = await supabase
      .from("person_identity_suggestions")
      .update({ status: "confirmed", ...stamp })
      .eq("id", suggestion.id);
    if (statusErr) throw statusErr;
    return { status: "confirmed", crew: true, name: suggestion.suggested_name, eventId: suggestion.event_id };
  }

  if (action === "confirm") {
    // Named some other way in the meantime? The human's earlier act wins —
    // supersede rather than overwrite.
    if (person.name) {
      await supabase
        .from("person_identity_suggestions")
        .update({ status: "superseded", ...stamp })
        .eq("id", suggestion.id);
      return { status: "superseded", existingName: person.name };
    }
    const { error: nameErr } = await supabase
      .from("persons")
      .update({ name: suggestion.suggested_name })
      .eq("id", suggestion.person_id);
    if (nameErr) throw nameErr;
    const { error: statusErr } = await supabase
      .from("person_identity_suggestions")
      .update({ status: "confirmed", ...stamp })
      .eq("id", suggestion.id);
    if (statusErr) throw statusErr;
    if (opts.teach) await teachEvent(supabase, userId, suggestion.event_id, suggestion.id);
    return { status: "confirmed", name: suggestion.suggested_name, eventId: suggestion.event_id };
  }

  // Reject: durable, spelling-proof, and scoped to this cluster.
  const rejected = new Set(person.rejected_names ?? []);
  rejected.add(suggestion.suggested_name);
  const { error: rejErr } = await supabase
    .from("persons")
    .update({ rejected_names: [...rejected] })
    .eq("id", suggestion.person_id);
  if (rejErr) throw rejErr;
  const { error: statusErr } = await supabase
    .from("person_identity_suggestions")
    .update({ status: "rejected", ...stamp })
    .eq("id", suggestion.id);
  if (statusErr) throw statusErr;
  return { status: "rejected", eventId: suggestion.event_id };
}

/**
 * Teach-on-confirm: the newly named cluster joins the reference library now,
 * not at the next scan. Best-effort with a REPORT — the confirm stands either
 * way, but a swallowed failure here would silently slow the engine's learning
 * (best-effort means the outcome is optional, never the evidence).
 */
export async function teachEvent(
  supabase: SupabaseDB,
  userId: string,
  eventId: string | null,
  suggestionId: string
) {
  // No gallery means the WHOLE-archive refresh, which no longer fits any
  // statement budget (lesson 173). The confirm stands; the next scan of the
  // cluster's gallery teaches instead.
  if (!eventId) return;
  const { error } = await supabase.rpc("refresh_person_reference_centroids", {
    p_user_id: userId,
    p_event_id: eventId,
    p_excluded_event_names: [...NON_PERSON_GALLERIES],
  });
  if (error) {
    await reportSystemError("people.identity-suggestions.teach", error, { suggestionId });
  }
}

export type UndoResult =
  | { status: "undone"; kind: "guest" | "crew"; name: string; eventId: string }
  | { status: "not_found" | "not_auto" | "gone" };

/**
 * Take back an auto decision. The person's word is the durable one, so this
 * is a REJECT with the engine's name added to the cluster's rejected list
 * (never re-asked), plus the un-teaching a human reject never needed: the
 * confirm already fed the reference library, so references are refreshed
 * (guest) or the snapshot face is removed from the crew set (crew).
 *
 * A guest name a human has since changed by hand is left alone — only the
 * engine's own name is cleared.
 */
export async function undoAutoDecision(
  supabase: SupabaseDB,
  userId: string,
  id: string
): Promise<UndoResult> {
  const { data: s } = await supabase
    .from("person_identity_suggestions")
    .select("id, user_id, person_id, event_id, kind, crew_id, suggested_name, status, decided_by")
    .eq("id", id)
    .maybeSingle();
  if (!s || s.user_id !== userId) return { status: "not_found" };
  if (s.status !== "confirmed" || s.decided_by !== "auto") return { status: "not_auto" };

  const { data: person } = await supabase
    .from("persons")
    .select("id, name, rejected_names, representative_face_id")
    .eq("id", s.person_id)
    .maybeSingle();
  if (!person) return { status: "gone" };

  const rejected = new Set(person.rejected_names ?? []);
  rejected.add(s.suggested_name);

  if (s.kind === "crew" && s.crew_id) {
    const { unconfirmCrewPerson } = await import("@/lib/crew-faces/match");
    const unlinked = await unconfirmCrewPerson(supabase, {
      userId,
      crewId: s.crew_id,
      personId: s.person_id,
    });
    if (!unlinked.ok) throw new Error(unlinked.error ?? "Crew unlink failed");
    // The confirm snapshotted the cluster's representative face into the crew
    // reference set; a wrong face there would keep teaching the wrong match.
    if (person.representative_face_id) {
      const { error } = await supabase
        .from("crew_faces")
        .delete()
        .eq("user_id", userId)
        .eq("crew_id", s.crew_id)
        .eq("face_id", person.representative_face_id)
        .eq("source", "confirmed-suggestion");
      if (error) throw error;
    }
    const { error: pErr } = await supabase
      .from("persons")
      .update({ rejected_names: [...rejected] })
      .eq("id", s.person_id);
    if (pErr) throw pErr;
  } else {
    const update: { rejected_names: string[]; name?: null } = { rejected_names: [...rejected] };
    if (person.name === s.suggested_name) update.name = null;
    const { error: pErr } = await supabase.from("persons").update(update).eq("id", s.person_id);
    if (pErr) throw pErr;
  }

  const now = new Date().toISOString();
  const { error: sErr } = await supabase
    .from("person_identity_suggestions")
    .update({ status: "rejected", decided_at: now, decided_by: "human", reviewed_at: now })
    .eq("id", s.id);
  if (sErr) throw sErr;

  // Un-teach: the name is gone, so the event's references drop it.
  if (s.kind !== "crew") await teachEvent(supabase, userId, s.event_id, s.id);

  return { status: "undone", kind: s.kind === "crew" ? "crew" : "guest", name: s.suggested_name, eventId: s.event_id };
}

/** "Looks right" — one card or the whole strip. Returns how many it marked. */
export async function markAutoReviewed(
  supabase: SupabaseDB,
  userId: string,
  ids: string[] | "all"
): Promise<number> {
  let q = supabase
    .from("person_identity_suggestions")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("decided_by", "auto")
    .is("reviewed_at", null);
  if (ids !== "all") q = q.in("id", ids);
  const { data, error } = await q.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
