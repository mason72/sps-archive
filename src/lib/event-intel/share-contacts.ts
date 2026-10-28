/**
 * "Who do I send this gallery to?" — recipient suggestions for the share email.
 *
 * Mason, 2026-10-28: "when I go to share can it suggest the point of contact's
 * email so I don't have to go dig it up?" The answer was already on the
 * calendar. Measured on the 40 most recent calendar-linked galleries that day:
 * 33 had a contact address in the calendar entry's DESCRIPTION, and of the 29
 * that had been emailed, 23 went to exactly that address. The misses were
 * mostly "same client, different person" (Appfolio Goleta had no contact;
 * Appfolio San Diego's went to someone @appfolio.com), which is what the
 * client-history source covers.
 *
 * Calendar ATTENDEES are deliberately not a source: on those 40 they were
 * almost all other photographers invited to the gig, never the client.
 *
 * Suggestions only. A chip adds an address to the Recipients box when clicked;
 * nothing is filled in on its own, because a wrong guess there is an email to
 * the wrong person.
 *
 * INTERNAL like the rest of Event Intel: client addresses and the calendar
 * behind them. The route gates it with `getIntelUser()`, and every read below
 * carries the owner filter, because the caller hands in the SERVICE client.
 */
import { fetchGigsInWindow, hasCalendarCredential, windowFor } from "./lookup-gigs";
import { extractContactEmails } from "./parse-calendar";
import { payerDomains } from "./apply-gig";
import { readAllRows } from "@/lib/supabase/paged";

export type ShareContactSource = "calendar" | "client" | "sent";

export interface ShareContact {
  email: string;
  source: ShareContactSource;
  /** One short line for the chip's tooltip and caption. */
  detail: string;
}

/** Our own addresses: the studio's, and the products'. Never the client. */
const OURS = /@(?:[a-z0-9-]+\.)*(?:twodudesphoto|simplephotoshare|pixeltrunk)\.com$/i;

/** How many past recipients of the same client are worth offering. */
const MAX_CLIENT_HISTORY = 3;

export interface RankInput {
  /** Addresses in the linked calendar entries' descriptions. */
  calendar: string[];
  /** Past recipients of OTHER galleries for the same client, any order. */
  history: { email: string; eventName: string; sentAt: string }[];
  /** Addresses this gallery has already been emailed to. */
  sentHere: string[];
  /** True for an address that must never be suggested (ours, the crew). */
  exclude: (email: string) => boolean;
}

/**
 * Calendar contact first, then the client's most recent past recipients, then
 * anyone this gallery already went to. One entry per address.
 *
 * An address already sent this gallery is MARKED, not hidden: a resend to the
 * same person is legitimate, and a contact that silently vanished from the list
 * would read as "the calendar has no contact".
 */
export function rankShareContacts(input: RankInput): ShareContact[] {
  const norm = (e: string) => e.trim().toLowerCase();
  const sent = new Set(input.sentHere.map(norm));
  const seen = new Set<string>();
  const out: ShareContact[] = [];
  const add = (email: string, source: ShareContactSource, detail: string) => {
    const e = norm(email);
    if (!e.includes("@") || seen.has(e) || input.exclude(e)) return;
    seen.add(e);
    out.push(sent.has(e) ? { email: e, source: "sent", detail: "Already sent this gallery" } : { email: e, source, detail });
  };

  for (const e of input.calendar) add(e, "calendar", "Contact on the calendar");

  const recent = [...input.history].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  let fromHistory = 0;
  for (const h of recent) {
    if (fromHistory >= MAX_CLIENT_HISTORY) break;
    const before = out.length;
    add(h.email, "client", `Sent ${h.eventName}`);
    if (out.length > before) fromHistory++;
  }

  for (const e of input.sentHere) add(e, "sent", "Already sent this gallery");
  return out;
}

/**
 * Does a calendar client field name this stored client? Whole leading words
 * only: "Appfolio SB" names "Appfolio", "FM Headshots" names "FM", and
 * "Appfolios" or "Sonya" name nothing.
 */
export function clientNameMatches(calendarClient: string, orgName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = norm(calendarClient);
  const o = norm(orgName);
  return !!o && (c === o || c.startsWith(`${o} `));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface ShareContactsResult {
  contacts: ShareContact[];
  /**
   * Why there may be no calendar contact, so the page can say so instead of
   * showing a silence that reads like "the calendar has none".
   * `unlinked` — this gallery is not tied to a calendar gig yet.
   * `unavailable` — it is, but the calendar could not be read just now.
   */
  calendar: "linked" | "unlinked" | "unavailable";
  /** The calendar read's own error, for the route to report. Never sent to the page. */
  calendarError?: unknown;
}

function recipientsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Suggestions for one gallery. Assumes the caller has proven Event Intel
 * access; proves ownership itself (404-shaped null when the event is not the
 * caller's).
 */
export async function loadShareContacts(
  db: Db,
  user: { id: string; email?: string | null },
  eventId: string,
  today: Date = new Date()
): Promise<ShareContactsResult | null> {
  const { data: event, error: evErr } = await db
    .from("events")
    .select("id, event_date, sort_date")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (evErr) throw evErr;
  if (!event) return null;

  const [intelRes, orgLinkRes, crewRes] = await Promise.all([
    db.from("event_intel").select("calendar_event_ids").eq("event_id", eventId).eq("user_id", user.id).maybeSingle(),
    db.from("event_orgs").select("org_id").eq("event_id", eventId).eq("user_id", user.id).eq("role", "payer"),
    db.from("crew").select("primary_email, aliases").eq("user_id", user.id),
  ]);
  for (const r of [intelRes, orgLinkRes, crewRes]) if (r.error) throw r.error;

  // ── the calendar contact ──
  const calendarIds: string[] = intelRes.data?.calendar_event_ids ?? [];
  let calendar: string[] = [];
  let clientNames: string[] = [];
  let calendarState: ShareContactsResult["calendar"] = calendarIds.length ? "linked" : "unlinked";
  let calendarError: unknown = null;
  if (calendarIds.length) {
    if (!hasCalendarCredential()) {
      // A configuration fact, not a failure: no error row (same rule as suggest-gig).
      calendarState = "unavailable";
    } else {
      try {
        // sort_date is always populated; without it a dateless gallery would
        // search the last 240 days of every calendar on each page open.
        const gigs = await fetchGigsInWindow(windowFor(event.event_date ?? event.sort_date, today));
        const linked = gigs.filter((g) => g.events.some((e) => e.id && calendarIds.includes(e.id)));
        const entries = linked.flatMap((g) => g.events).filter((e) => e.id && calendarIds.includes(e.id));
        calendar = [...new Set(entries.flatMap((e) => extractContactEmails(e.description)))];
        clientNames = linked.map((g) => g.client).filter((c): c is string => !!c);
      } catch (err) {
        // The client history still answers; the page says the calendar did not,
        // and the route reports the real cause.
        calendarState = "unavailable";
        calendarError = err;
      }
    }
  }

  // ── who must never be suggested ──
  const crewEmails = new Set<string>();
  for (const c of crewRes.data ?? []) {
    for (const a of [c.primary_email, ...(c.aliases ?? [])]) if (a) crewEmails.add(String(a).toLowerCase());
  }
  const own = (user.email ?? "").toLowerCase();
  const exclude = (e: string) => OURS.test(e) || crewEmails.has(e) || (!!own && e === own);

  // ── the client's domains: the linked client, the calendar contact's domain,
  // and a stored client whose name leads the calendar's client field. That last
  // one is for an entry with no address in it: "Appfolio SB" (Goleta,
  // 2026-08-05) has no email and no client link, but "Appfolio" is a client. ──
  const linkedOrgIds = new Set((orgLinkRes.data ?? []).map((r: { org_id: string }) => r.org_id));
  const domains = new Set<string>(payerDomains(calendar));
  if (linkedOrgIds.size || clientNames.length) {
    const { data: orgs, error } = await db.from("organizations").select("id, name, domains").eq("user_id", user.id);
    if (error) throw error;
    for (const o of orgs ?? []) {
      if (linkedOrgIds.has(o.id) || clientNames.some((c) => clientNameMatches(c, o.name))) {
        for (const d of o.domains ?? []) domains.add(String(d).toLowerCase());
      }
    }
  }

  // ── what has been sent: this gallery, and the client's other galleries ──
  const sends = await readAllRows<{ event_id: string; recipients: unknown; sent_at: string | null; status: string | null }>(
    () => db.from("email_sends").select("id, event_id, recipients, sent_at, status").eq("user_id", user.id)
  );
  const sentHere: string[] = [];
  const pastRaw: { email: string; eventId: string; sentAt: string }[] = [];
  for (const s of sends) {
    // A send whose gallery was deleted keeps its row with event_id NULL
    // (migration 005, ON DELETE SET NULL). It is not evidence, and a null in
    // the `.in()` below fails the whole lookup.
    if (s.status === "failed" || !s.event_id) continue;
    for (const r of recipientsOf(s.recipients)) {
      const email = r.trim().toLowerCase();
      if (s.event_id === eventId) sentHere.push(email);
      else if (domains.has(email.split("@")[1] ?? "")) pastRaw.push({ email, eventId: s.event_id, sentAt: s.sent_at ?? "" });
    }
  }

  const names = new Map<string, string>();
  const pastIds = [...new Set(pastRaw.map((p) => p.eventId))];
  for (let i = 0; i < pastIds.length; i += 100) {
    const { data, error } = await db.from("events").select("id, name").in("id", pastIds.slice(i, i + 100)).eq("user_id", user.id);
    if (error) throw error;
    for (const e of data ?? []) names.set(e.id, e.name);
  }
  // A send whose event is gone, or not the caller's, is not evidence.
  const history = pastRaw
    .filter((p) => names.has(p.eventId))
    .map((p) => ({ email: p.email, eventName: names.get(p.eventId)!, sentAt: p.sentAt }));

  return {
    contacts: rankShareContacts({ calendar, history, sentHere, exclude }),
    calendar: calendarState,
    calendarError,
  };
}
