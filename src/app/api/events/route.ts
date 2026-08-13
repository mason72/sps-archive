import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { enrichEvents } from "@/lib/events/enrich";
import { reportSystemError } from "@/lib/monitoring/report";
import { resolveEventStatuses } from "@/lib/events/status";
import { INTAKE_SECTION_NAME, CURATED_SECTION_NAME } from "@/lib/sections/intake";
import type { Json } from "@/lib/supabase/database.types";

/**
 * GET /api/events — List all events for the authenticated user.
 *
 * The list query deliberately does NOT embed `images(count)`. PostgREST turns
 * that into a correlated subquery per event row, and on a table written to as
 * constantly as `images` (uploads, AI indexing, SPS pulls) the visibility map
 * is never current, so the "index-only" scan degrades to a heap fetch per row —
 * 23,136 of them for 26 events. Warm that was 16ms; under write load it went
 * past the 8s statement_timeout PostgREST inherits from `authenticator`,
 * Postgres cancelled the statement, and the ENTIRE dashboard 500'd. Three times
 * in one 45-minute window on 2026-08-12, cured only by hard refreshing until
 * the database was quiet enough.
 *
 * The count now comes from `event_readiness` (migration 047), which was already
 * being called on this same request and aggregates the same rows in ONE grouped
 * pass. Same number, one fewer scan, and the events list no longer touches
 * `images` at all.
 *
 * The enrichment legs are also no longer allowed to take the page down with
 * them: a dashboard that renders 26 galleries without their status badges is
 * far better than an empty page reading "Something went wrong", which is what
 * every one of these failures produced.
 */
/**
 * Turn a date fragment typed into the search box into a half-open range.
 *
 * Accepts a year ("2022"), a year-month ("2022-06") or a full date
 * ("2022-06-06"), and returns the day AFTER the fragment as the exclusive upper
 * bound — so December rolls to the next January rather than producing month 13,
 * and a full date matches exactly that day rather than nothing.
 *
 * Returns null for anything that is not a date, so ordinary text searches are
 * unaffected.
 */
function dateFragmentRange(q: string): { from: string; to: string } | null {
  const pad = (n: number) => String(n).padStart(2, "0");

  const year = q.match(/^(\d{4})$/);
  if (year) {
    const y = Number(year[1]);
    if (y < 1900 || y > 2200) return null;
    return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
  }

  const ym = q.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (m < 1 || m > 12) return null;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    return { from: `${y}-${pad(m)}-01`, to: `${nextY}-${pad(nextM)}-01` };
  }

  const ymd = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, ys, ms, ds] = ymd;
    const d = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds)));
    if (Number.isNaN(d.getTime())) return null;
    const next = new Date(d.getTime() + 86400000);
    return {
      from: `${ys}-${pad(Number(ms))}-${pad(Number(ds))}`,
      to: next.toISOString().slice(0, 10),
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const q = (searchParams.get("q") || "").trim();
    const eventType = (searchParams.get("type") || "").trim();

    let query = supabase
      .from("events")
      .select("*", { count: "exact" })
      .eq("user_id", user!.id);

    /**
     * Search and type filter run in the DATABASE, not on the loaded page.
     *
     * They used to be client-side over whatever the list had fetched, which was
     * correct only while every event fit in one request. With the Pixieset
     * archive that stops being true, and a client-side filter over a paged list
     * does not degrade — it LIES: typing a gallery's name returns nothing
     * whenever that gallery happens to sit past the loaded page, with no
     * indication that the search was partial.
     */
    if (q) {
      const safe = q.replace(/[%,()]/g, " ").trim();
      if (safe) {
        const clauses = [`name.ilike.%${safe}%`, `event_type.ilike.%${safe}%`];
        /**
         * A date fragment searches the DATE, not the name.
         *
         * The old client-side filter matched `event_date.includes(q)`, so typing
         * "2022" found every gallery shot that year. Moving search to the
         * database dropped that silently — "2022" returned nothing at all, which
         * is exactly how it was reported. Expressed as a RANGE rather than a
         * string match so it uses the index and so "2022" cannot also match a
         * gallery that merely has 2022 in its title for another reason.
         */
        const range = dateFragmentRange(safe);
        if (range) {
          clauses.push(`and(event_date.gte.${range.from},event_date.lt.${range.to})`);
        }
        query = query.or(clauses.join(","));
      }
    }
    if (eventType) query = query.eq("event_type", eventType);

    const { data, error, count } = await query
      // Pinned galleries (e.g. TDP workspaces) stay above the chronological list
      .order("pinned_at", { ascending: false, nullsFirst: false })
      /**
       * Order by the day the work HAPPENED, not the day the row was written.
       *
       * `created_at` was equivalent while every event was created near its own
       * date. The Pixieset import breaks that completely: 1,371 galleries
       * spanning 2014–2023 all get today's `created_at`, so ordering by it would
       * stack twelve years of back-catalogue ON TOP of the live client work —
       * the current galleries do not just sink, they leave the first page
       * entirely.
       *
       * `nullsFirst: false` matters: `event_date` is NULL on a meaningful share
       * of hand-created events, and those belong at the end rather than above
       * everything. `created_at` remains the tiebreak so same-day events keep a
       * stable, deterministic order — without it, paging can show or skip a row
       * as the sort shuffles between requests.
       */
      .order("event_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // This one IS fatal — it is the page's content, and there is nothing to
    // render without it.
    if (error) throw new Error(`events list: ${error.message}`);

    // Enrich cover thumbnails + share slugs with a FIXED number of batched
    // queries (the old per-event fan-out was an N+1 — ~3 queries per event — that
    // made the dashboard crawl for photographers with many events).
    //
    // allSettled, not all: each leg is an ENHANCEMENT of a row we already hold,
    // so one failing costs its own feature and nothing else.
    const events = data || [];
    const [enrichmentRes, statusRes] = await Promise.allSettled([
      enrichEvents(supabase, events),
      // Delivery stage + pipeline readiness + the row count, same batched
      // discipline.
      resolveEventStatuses(supabase, events.map((e) => e.id)),
    ]);

    if (enrichmentRes.status === "rejected") {
      void reportSystemError("events.list.enrich", enrichmentRes.reason);
    }
    if (statusRes.status === "rejected") {
      void reportSystemError("events.list.status", statusRes.reason);
    }

    const enrichment =
      enrichmentRes.status === "fulfilled" ? enrichmentRes.value : null;
    const statuses = statusRes.status === "fulfilled" ? statusRes.value : null;

    const enriched = events.map((event) => {
      const status = statuses?.get(event.id) ?? null;
      return {
        ...event,
        ...(enrichment?.get(event.id) ?? {
          coverThumbnailUrl: null,
          coverFocal: null,
          activeShareSlug: null,
        }),
        status,
        // The card's "N images" in the shape the client has always read. NULL
        // rather than 0 when the count is unavailable: a card silently reading
        // "0 images" over a full gallery is a worse failure than an absent
        // line, because it is indistinguishable from an empty event.
        images: status ? [{ count: status.readiness.rows }] : null,
      };
    });

    /**
     * The distinct type list for the filter chips, from the WHOLE archive.
     *
     * The client used to derive these from the events it had loaded. Once the
     * list is paged that is wrong twice over: types only present on later pages
     * vanish, and selecting a filter collapses the chip row to the one type
     * still on screen — removing the control needed to undo the filter.
     * Cheap query: one column, no joins.
     */
    let types: string[] = [];
    {
      const { data: typeRows } = await supabase
        .from("events")
        .select("event_type")
        .eq("user_id", user!.id)
        .not("event_type", "is", null);
      types = [...new Set((typeRows ?? []).map((r) => r.event_type as string).filter(Boolean))].sort();
    }

    return NextResponse.json({
      types,
      events: enriched,
      total: count,
      limit,
      offset,
      // Named so the client can say WHICH part is missing instead of guessing.
      degraded: {
        status: statusRes.status === "rejected",
        covers: enrichmentRes.status === "rejected",
      },
    });
  } catch (error) {
    console.error("GET /api/events:", error);
    void reportSystemError("events.list", error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

/** POST /api/events — Create a new event */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { name, description, eventDate, eventType, settings, sections } = body as {
      name: string;
      description?: string;
      eventDate?: string;
      eventType?: string;
      settings?: Record<string, unknown>;
      sections?: { name: string; description?: string; sortOrder: number }[];
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      + "-" + Date.now().toString(36);

    const { data, error } = await supabase
      .from("events")
      .insert({
        name,
        slug,
        description: description || null,
        event_date: eventDate || null,
        event_type: eventType || null,
        settings: (settings || {}) as Json,
        user_id: user!.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Create sections from template if provided, otherwise seed a default
    // "Highlights" section. NOTE: never name a real section "All Photos" —
    // "All Photos" is a derived view (the union of all sections), not a row.
    if (sections && sections.length > 0 && data) {
      const sectionInserts = sections.map((s) => ({
        event_id: data.id,
        name: s.name,
        description: s.description || null,
        sort_order: s.sortOrder,
        is_auto: false,
      }));

      await supabase.from("sections").insert(sectionInserts);
    } else if (data) {
      // Seed two sections: "Unsorted" (the intake — where big dumps land so
      // they never touch Highlights) at the top, then "Highlights" (reserved
      // for the curated/exported best-of). "Sort into sections" later consumes
      // Unsorted. Never name a real section "All Photos" (a derived view).
      await supabase.from("sections").insert([
        { event_id: data.id, name: INTAKE_SECTION_NAME, sort_order: 0, is_auto: false },
        { event_id: data.id, name: CURATED_SECTION_NAME, sort_order: 1, is_auto: false },
      ]);
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error) {
    console.error("Create event error:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
