import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * One person's judgement history — what has been claimed about them, by whom.
 *
 * Reads `crew_change_log` (migration 073). Deliberately its own route rather
 * than a field on `GET /api/crew`: the roster payload already carries 87 people
 * with their event counts and derived last-hired dates, and folding a full
 * history into it would multiply that by every change ever made to serve a
 * panel almost nobody has open. One person, on demand.
 *
 * Ownership is filtered here as everywhere else — `getIntelUser()` hands back
 * the SERVICE client, so RLS is bypassed and the `.eq("user_id", …)` below is
 * the actual protection. Without it this route is an IDOR that reads out
 * another archive's rehire judgements about named people, which is the most
 * sensitive thing Intel holds.
 */

/** Plain-language labels. The column names are not what a person calls these. */
const FIELD_LABEL: Record<string, string> = {
  created: "Added to the roster",
  is_regular: "Regular",
  rehire: "Rehire (baseline)",
  archived: "Alumni",
  notes: "Notes",
  would_rebook: "Rehire (this gig)",
  note: "Gig note",
};

const SOURCE_LABEL: Record<string, string> = {
  roster: "Roster",
  event: "Event screen",
  "apply-gig": "Applied with a gig",
  script: "Script",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ crewId: string }> }
) {
  const { crewId } = await params;
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { data, error } = await db
      .from("crew_change_log")
      .select("seq, field, old_value, new_value, actor_label, source, changed_at, event_id, events(name, event_date)")
      .eq("crew_id", crewId)
      .eq("user_id", user!.id)
      /**
       * Ordered by `seq`, never `changed_at`. Two fields changed by one UPDATE
       * share a transaction timestamp exactly, so a sort on the clock has no
       * defined order between them — the same defect as the unordered `.range()`
       * paging in lesson #88, and it showed up in this table's first test.
       */
      .order("seq", { ascending: false })
      .limit(200);
    if (error) throw error;

    return NextResponse.json({
      history: (data ?? []).map((r: Record<string, any>) => ({
        seq: r.seq,
        field: r.field,
        label: FIELD_LABEL[r.field] ?? r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        /**
         * Null actor is not missing data — it is a write that came from
         * outside the app (a script, a console edit) and did not sign itself.
         * The UI says so rather than showing a blank, because a silent gap
         * reads as "nobody knows" when the truth is "not done through a
         * screen".
         */
        actor: r.actor_label ?? null,
        source: r.source ? SOURCE_LABEL[r.source] ?? r.source : null,
        changedAt: r.changed_at,
        event: r.event_id
          ? { id: r.event_id, name: r.events?.name ?? null, date: r.events?.event_date ?? null }
          : null,
      })),
    });
  } catch (err) {
    await reportSystemError("api.crew.history.GET", err, { crewId });
    return NextResponse.json({ error: "Could not load the history" }, { status: 500 });
  }
}
