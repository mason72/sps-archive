/**
 * Google Calendar access for Event Intel — service account, read only.
 *
 * No SDK. The service-account flow is a signed JWT exchanged for an access
 * token, which is about thirty lines with `node:crypto` — against `googleapis`,
 * which is a ~50 MB dependency pulling in every Google API, in a Next app whose
 * cold start we care about. If this ever needs Drive, Sheets and Gmail too, that
 * trade flips; for two calendars it does not.
 *
 * CREDENTIAL SHAPE. Either:
 *   GOOGLE_CALENDAR_KEY       the service-account JSON, inline (Vercel)
 *   GOOGLE_CALENDAR_KEY_FILE  a path to it (local; defaults to the repo file)
 * The file is gitignored and mode 600. It is a live private key: never log it,
 * never put it in an error message, never return it from a route.
 *
 * SCOPE IS READ-ONLY and should stay that way. Nothing in this feature writes to
 * a calendar, and a token that cannot write is one that cannot damage twelve
 * years of scheduling if this code is ever wrong.
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CalendarEventLike } from "./parse-calendar";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

/** The two calendars that carry Two Dudes gigs. See tasks/event-intel.md. */
export const CALENDARS = {
  /** Photo booth jobs. Verified back to 2014. */
  gigs: "6jhfih8prj4erj9aspsv7au7gc@group.calendar.google.com",
  /** Headshots and event photography — most Pixieset collections. From ~2016-09. */
  exposure: "out00v9tpf06eldqsquh8m8d7s@group.calendar.google.com",
  /**
   * In-studio headshots, booked through Squarespace/Acuity. A completely
   * different entry shape (see `parseStudioSession`) — individual clients, no
   * crew, always the same venue. Four galleries looked absent from "the
   * calendar" until this was included, because they were never on the other two.
   */
  studio: "jafn9nsi12jnjmsgf7oau3kks4@group.calendar.google.com",
} as const;

/** Calendars whose entries are Acuity studio bookings, not crewed gigs. */
export const STUDIO_CALENDARS = new Set<CalendarKey>(["studio"]);

export type CalendarKey = keyof typeof CALENDARS;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

let cached: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const inline = process.env.GOOGLE_CALENDAR_KEY;
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      // Deliberately does not echo the value.
      throw new Error("GOOGLE_CALENDAR_KEY is set but is not valid JSON");
    }
  }
  const path =
    process.env.GOOGLE_CALENDAR_KEY_FILE ||
    join(process.cwd(), ".google-calendar-key.json");
  if (!existsSync(path)) {
    throw new Error(
      `No Google Calendar credential. Set GOOGLE_CALENDAR_KEY (inline JSON) or place the key at ${path}`
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Exchange a self-signed JWT for an access token.
 *
 * Cached until shortly before expiry: a backfill walking twelve years makes
 * thousands of calls and re-minting a token per request is both slow and a good
 * way to get rate limited.
 */
export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    // Google's error body names the problem (invalid_grant, unauthorized_client)
    // and contains no secret, so it is worth surfacing.
    throw new Error(`Google token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export interface ListOptions {
  timeMin?: string;
  timeMax?: string;
  /** Hard cap on pages, so a bad filter cannot walk forever. */
  maxPages?: number;
}

/**
 * Every event in a window, following pagination.
 *
 * `singleEvents` expands recurring entries into their instances — without it a
 * weekly hold returns once and every real occurrence is invisible.
 */
export async function listEvents(
  calendar: CalendarKey | string,
  { timeMin, timeMax, maxPages = 100 }: ListOptions = {}
): Promise<CalendarEventLike[]> {
  const id = (CALENDARS as Record<string, string>)[calendar] ?? calendar;
  const token = await getAccessToken();
  const out: CalendarEventLike[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (timeMin) params.set("timeMin", timeMin);
    if (timeMax) params.set("timeMax", timeMax);
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${API}/calendars/${encodeURIComponent(id)}/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Calendar ${id} list failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { items?: CalendarEventLike[]; nextPageToken?: string };
    out.push(...(json.items ?? []));
    if (!json.nextPageToken) return out;
    pageToken = json.nextPageToken;
  }
  return out;
}

/**
 * Can the service account actually see each calendar?
 *
 * Sharing a calendar with a service account is a separate manual step from
 * creating it, and forgetting it fails as an empty result rather than an error —
 * a backfill that silently finds nothing looks identical to a backfill with
 * nothing to find. Worth its own check.
 */
export async function checkAccess(): Promise<
  { calendar: CalendarKey; id: string; ok: boolean; summary?: string; error?: string }[]
> {
  const token = await getAccessToken();
  const out = [];
  for (const [key, id] of Object.entries(CALENDARS) as [CalendarKey, string][]) {
    const res = await fetch(`${API}/calendars/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const j = (await res.json()) as { summary?: string };
      out.push({ calendar: key, id, ok: true, summary: j.summary });
    } else {
      const detail = await res.text();
      out.push({ calendar: key, id, ok: false, error: `${res.status}: ${detail.slice(0, 160)}` });
    }
  }
  return out;
}
