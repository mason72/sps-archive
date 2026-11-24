/**
 * Jobs — the "TDP Work" gallery (sister of "TDP Website").
 *
 * The website's Featured Work is job-based: each tile is a job and opens an
 * infosheet ("job sheet") with project data and quote CTAs. In Pixeltrunk,
 * each SECTION of the TDP Work gallery is one job: its images are the job's
 * gallery, the first image by drag order is the cover, and section order is
 * the order jobs lead on the site.
 *
 * Job sections carry sections.site_scene_key = "job/<slug>" — the same column
 * the TDP Website gallery uses, so the entire v2 lane (publication gate,
 * revalidate-webhook scoping, focal-point tool, section locks) applies with
 * no extra wiring. The slug is frozen at creation (derived from the section
 * name) so renaming a job never moves it on the site; the job form can still
 * edit the slug deliberately.
 *
 * Job metadata is one jsonb document on the section (sections.job_meta),
 * validated here — this module is the single source of truth for the shape,
 * shared by the editor form, the sections PATCH route, and GET /api/site/jobs.
 * Enum values and label wording mirror the website's src/lib/jobs.ts.
 *
 * A job is returned by the API only when its REQUIRED fields are complete
 * (the site's Job type needs them non-null) and it has ≥1 published image;
 * until then it's an editor-visible draft ("Not live — missing: …").
 */

export const WORK_EVENT_SLUG = "tdp-work";
export const WORK_EVENT_NAME = "TDP Work";

/**
 * Is this event THE TDP Work gallery? By slug, never by `settings.work`.
 *
 * Event slugs are generated on the server (name + timestamp suffix), can never
 * be written by a client, and are unique across every account, and `tdp-work`
 * already belongs to Two Dudes. A settings flag is client-writable: until
 * 2026-11-14 any account could set `work: true` on its own event and publish
 * to TDP's Featured Work (pilot audit). The flag stays in the data; nothing
 * that decides publication reads it.
 */
export function isWorkGalleryEvent(event: { slug?: string | null } | null | undefined): boolean {
  return event?.slug === WORK_EVENT_SLUG;
}

/** site_scene_key namespace for job sections: "job/<slug>". */
export const JOB_KEY_PREFIX = "job/";

export function isJobSceneKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(JOB_KEY_PREFIX);
}

export function jobSlugFromKey(key: string): string {
  return key.slice(JOB_KEY_PREFIX.length);
}

/* ─── Enums (keep in sync with the website's src/lib/jobs.ts) ─── */

/**
 * The site's 7 bookable services (its services roster). Deliberately NOT
 * SITE_SERVICES from scenes.ts: that list includes environmental-portraits,
 * which is a content scene but not a service the site sells.
 */
export const JOB_SERVICES = [
  "headshot-booth",
  "photo-booth",
  "anti-booth",
  "event-photography",
  "video",
  "office-headshots",
  "drop-in-sessions",
] as const;

export const JOB_EVENT_SIZES = ["under-500", "500-2000", "2000-10000", "10000-plus"] as const;
export const JOB_DURATIONS = ["half-day", "1-day", "2-3-days", "4-5-days", "week-plus"] as const;
export const JOB_TEAMS = ["1", "2", "3", "4-6", "7-plus"] as const;
export const JOB_BALLPARKS = ["under-6k", "6-12k", "12-24k", "24-48k", "48-100k", "100k-plus"] as const;
export const JOB_INDUSTRIES = ["tech", "finance", "healthcare", "retail", "entertainment", "nonprofit", "other"] as const;

export type JobEventSize = (typeof JOB_EVENT_SIZES)[number];
export type JobDuration = (typeof JOB_DURATIONS)[number];
export type JobTeams = (typeof JOB_TEAMS)[number];
export type JobBallpark = (typeof JOB_BALLPARKS)[number];
export type JobIndustry = (typeof JOB_INDUSTRIES)[number];

/** Editor labels — exactly the copy the website renders, so WYSIWYG. */
export const JOB_EVENT_SIZE_LABELS: Record<JobEventSize, string> = {
  "under-500": "Under 500 guests",
  "500-2000": "500 to 2,000 guests",
  "2000-10000": "2,000 to 10,000 guests",
  "10000-plus": "10,000+ guests",
};

export const JOB_DURATION_LABELS: Record<JobDuration, string> = {
  "half-day": "Half day",
  "1-day": "1 day",
  "2-3-days": "2 to 3 days",
  "4-5-days": "4 to 5 days",
  "week-plus": "A week or more",
};

export const JOB_TEAMS_LABELS: Record<JobTeams, string> = {
  "1": "1",
  "2": "2",
  "3": "3",
  "4-6": "4 to 6",
  "7-plus": "7+ on the floor",
};

export const JOB_BALLPARK_LABELS: Record<JobBallpark, string> = {
  "under-6k": "Under $6k",
  "6-12k": "$6k to $12k",
  "12-24k": "$12k to $24k",
  "24-48k": "$24k to $48k",
  "48-100k": "$48k to $100k",
  "100k-plus": "$100k+",
};

export const JOB_INDUSTRY_LABELS: Record<JobIndustry, string> = {
  tech: "Tech",
  finance: "Finance",
  healthcare: "Healthcare",
  retail: "Retail",
  entertainment: "Entertainment",
  nonprofit: "Nonprofit",
  other: "Other…",
};

export const JOB_SERVICE_LABELS: Record<(typeof JOB_SERVICES)[number], string> = {
  "headshot-booth": "Headshot Booth",
  "photo-booth": "Photo Booth",
  "anti-booth": "Anti-Booth",
  "event-photography": "Event Photography",
  video: "Video",
  "office-headshots": "Office Headshots",
  "drop-in-sessions": "Drop-In Sessions",
};

/* ─── The metadata document (sections.job_meta) ─── */

export interface JobMeta {
  /** The real client name — internal record; never serialized when anonymized. */
  client: string | null;
  anonymize: boolean;
  /** Public stand-in shown when anonymized ("Fortune 100 tech company"). */
  alias: string | null;
  eventName: string | null;
  city: string | null;
  venue: string | null;
  /** Site service slugs (subset of JOB_SERVICES). */
  services: string[];
  eventSize: JobEventSize | null;
  duration: JobDuration | null;
  teams: JobTeams | null;
  /** Null = the ballpark row is hidden on the site. */
  ballpark: JobBallpark | null;
  industry: JobIndustry | null;
  /** Required (and serialized) only when industry === "other". */
  industryOther: string | null;
  year: number | null;
  /** Hair + makeup touchup artists on site — the job sheet's TOUCHUPS row. */
  touchups: boolean;
  /** Leads the site's /work index as a magazine spread. */
  special: boolean;
  /** The written case study. Only a PUBLISHED story leaves the server. */
  story: JobStoryMeta | null;
  /** The client galleries this job delivered; proof is counted from them. */
  sources: JobSource[];
  /** Counted by the server from `sources` on every save. Never typed, and
      never accepted from a request body (validateJobMeta drops it). */
  proof: JobProofMeta | null;
}

/* ─── Case-study fields (2026-11-23, twodudesphoto.com/work) ─── */

export const JOB_STORY_STATUSES = ["draft", "published"] as const;
/** Who wrote it: a draft from Claude or Scout waits for Mason's approval. */
export const JOB_STORY_SOURCES = ["mason", "claude", "scout"] as const;
export type JobStoryStatus = (typeof JOB_STORY_STATUSES)[number];
export type JobStorySource = (typeof JOB_STORY_SOURCES)[number];

export const STORY_LIMITS = { headline: 120, dek: 300, body: 6000, quote: 600, by: 120, role: 120 } as const;

export interface JobStoryMeta {
  status: JobStoryStatus;
  source: JobStorySource;
  headline: string;
  dek: string | null;
  /** Plain text; a blank line separates paragraphs. */
  body: string;
  /** A real client quote only: never paraphrased into one. */
  quote: { text: string; by: string; role: string | null } | null;
}

export interface JobSource {
  eventId: string;
  /** Count this gallery's people. Only honest for headshot-led galleries:
      event coverage finds a fraction of the faces (Atlassian Expo 2026 =
      7,747 photos, 111 people). */
  people: boolean;
}

export interface JobProofMeta {
  photos: number;
  galleries: number;
  /** Null when no source gallery is marked for people. */
  people: number | null;
  /** Photos per hour from each day's first frame (see job-proof.ts). */
  days: number[][] | null;
  countedAt: string;
}

export const MAX_JOB_SOURCES = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EMPTY_JOB_META: JobMeta = {
  client: null,
  anonymize: false,
  alias: null,
  eventName: null,
  city: null,
  venue: null,
  services: [],
  eventSize: null,
  duration: null,
  teams: null,
  ballpark: null,
  industry: null,
  industryOther: null,
  year: null,
  touchups: false,
  special: false,
  story: null,
  sources: [],
  proof: null,
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Body text keeps its paragraphs: CRLF folded, 3+ newlines become one blank line. */
function cleanBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return body.length > 0 ? body : null;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Lenient story reader: anything without a headline and body is "no story". */
export function parseStory(raw: unknown): JobStoryMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const headline = cleanText(r.headline);
  const body = cleanBody(r.body);
  if (!headline || !body) return null;
  let quote: JobStoryMeta["quote"] = null;
  if (r.quote && typeof r.quote === "object" && !Array.isArray(r.quote)) {
    const q = r.quote as Record<string, unknown>;
    const text = cleanText(q.text);
    const by = cleanText(q.by);
    if (text && by) quote = { text, by, role: cleanText(q.role) };
  }
  return {
    // Unknown status reads as draft: an unreadable flag must never publish.
    status: r.status === "published" ? "published" : "draft",
    source: asEnum(r.source, JOB_STORY_SOURCES) ?? "mason",
    headline,
    dek: cleanText(r.dek),
    body,
    quote,
  };
}

function parseSources(raw: unknown): JobSource[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: JobSource[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const id = typeof r.eventId === "string" ? r.eventId.toLowerCase() : "";
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ eventId: id, people: r.people === true });
  }
  return out.slice(0, MAX_JOB_SOURCES);
}

function parseProof(raw: unknown): JobProofMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isCount(r.photos) || !isCount(r.galleries) || typeof r.countedAt !== "string") return null;
  const days = Array.isArray(r.days)
    ? r.days.filter((d): d is number[] => Array.isArray(d) && d.every(isCount))
    : null;
  return {
    photos: r.photos,
    galleries: r.galleries,
    people: isCount(r.people) ? r.people : null,
    days: days && days.length > 0 ? days : null,
    countedAt: r.countedAt,
  };
}

/**
 * Read a stored job_meta document into a fully-shaped JobMeta. Lenient by
 * design (it reads what validateJobMeta wrote, but must survive anything):
 * unknown fields are dropped, bad values become null/[].
 */
export function parseJobMeta(raw: unknown): JobMeta {
  if (!raw || typeof raw !== "object") return { ...EMPTY_JOB_META };
  const obj = raw as Record<string, unknown>;
  const services = Array.isArray(obj.services)
    ? [...new Set(obj.services.filter((s): s is string =>
        (JOB_SERVICES as readonly string[]).includes(s as string)
      ))]
    : [];
  const year =
    typeof obj.year === "number" && Number.isInteger(obj.year) ? obj.year : null;
  const industry = asEnum(obj.industry, JOB_INDUSTRIES);
  return {
    client: cleanText(obj.client),
    anonymize: obj.anonymize === true,
    alias: cleanText(obj.alias),
    eventName: cleanText(obj.eventName),
    city: cleanText(obj.city),
    venue: cleanText(obj.venue),
    services,
    eventSize: asEnum(obj.eventSize, JOB_EVENT_SIZES),
    duration: asEnum(obj.duration, JOB_DURATIONS),
    teams: asEnum(obj.teams, JOB_TEAMS),
    ballpark: asEnum(obj.ballpark, JOB_BALLPARKS),
    industry,
    industryOther: industry === "other" ? cleanText(obj.industryOther) : null,
    year,
    touchups: obj.touchups === true,
    special: obj.special === true,
    story: parseStory(obj.story),
    sources: parseSources(obj.sources),
    proof: parseProof(obj.proof),
  };
}

function storyError(raw: unknown): string | null {
  if (typeof raw !== "object" || Array.isArray(raw)) return "story must be an object or null";
  const r = raw as Record<string, unknown>;
  if (!(JOB_STORY_STATUSES as readonly string[]).includes(r.status as string)) {
    return `Invalid story status: ${String(r.status)}`;
  }
  if (!(JOB_STORY_SOURCES as readonly string[]).includes(r.source as string)) {
    return `Invalid story source: ${String(r.source)}`;
  }
  const strings: Array<[string, unknown, number, boolean]> = [
    ["headline", r.headline, STORY_LIMITS.headline, true],
    ["dek", r.dek, STORY_LIMITS.dek, false],
    ["body", r.body, STORY_LIMITS.body, true],
  ];
  for (const [field, value, max, required] of strings) {
    if (value != null && typeof value !== "string") return `story ${field} must be a string`;
    const len = typeof value === "string" ? value.trim().length : 0;
    if (required && len === 0) return `A story needs a ${field}`;
    if (len > max) return `story ${field} is over ${max} characters`;
  }
  if (r.quote != null) {
    if (typeof r.quote !== "object" || Array.isArray(r.quote)) return "story quote must be an object or null";
    const q = r.quote as Record<string, unknown>;
    for (const [field, max] of [["text", STORY_LIMITS.quote], ["by", STORY_LIMITS.by], ["role", STORY_LIMITS.role]] as const) {
      if (q[field] != null && typeof q[field] !== "string") return `quote ${field} must be a string`;
      if (typeof q[field] === "string" && (q[field] as string).trim().length > max) {
        return `quote ${field} is over ${max} characters`;
      }
    }
    // A quote is a real person's words: it needs both, or it is not a quote.
    if (!cleanText(q.text) || !cleanText(q.by)) return "A quote needs its text and who said it";
  }
  return null;
}

function sourcesError(raw: unknown): string | null {
  if (!Array.isArray(raw)) return "sources must be an array";
  if (raw.length > MAX_JOB_SOURCES) return `At most ${MAX_JOB_SOURCES} source galleries`;
  const seen = new Set<string>();
  for (const s of raw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return "Each source must be an object";
    const r = s as Record<string, unknown>;
    if (typeof r.eventId !== "string" || !UUID_RE.test(r.eventId)) return "Invalid source gallery id";
    if (r.people != null && typeof r.people !== "boolean") return "source people must be a boolean";
    const id = r.eventId.toLowerCase();
    if (seen.has(id)) return "A gallery is listed twice";
    seen.add(id);
  }
  return null;
}

/**
 * Validate an editor submission (PATCH body) into a storable JobMeta.
 * Strict where it matters: bad enum values and malformed fields are ERRORS
 * (the form should never produce them), not silent drops. Partial documents
 * are fine — completeness is a separate, softer check (jobMissingFields).
 */
export function validateJobMeta(
  input: unknown
): { meta: JobMeta } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "jobMeta must be an object" };
  }
  const obj = input as Record<string, unknown>;

  for (const field of ["client", "alias", "eventName", "city", "venue", "industryOther"]) {
    if (obj[field] != null && typeof obj[field] !== "string") {
      return { error: `${field} must be a string` };
    }
  }
  if (obj.anonymize != null && typeof obj.anonymize !== "boolean") {
    return { error: "anonymize must be a boolean" };
  }
  if (obj.touchups != null && typeof obj.touchups !== "boolean") {
    return { error: "touchups must be a boolean" };
  }
  if (obj.services != null) {
    if (!Array.isArray(obj.services)) return { error: "services must be an array" };
    for (const s of obj.services) {
      if (!(JOB_SERVICES as readonly string[]).includes(s as string)) {
        return { error: `Unknown service: ${String(s)}` };
      }
    }
  }
  const enumChecks: Array<[string, readonly string[]]> = [
    ["eventSize", JOB_EVENT_SIZES],
    ["duration", JOB_DURATIONS],
    ["teams", JOB_TEAMS],
    ["ballpark", JOB_BALLPARKS],
    ["industry", JOB_INDUSTRIES],
  ];
  for (const [field, allowed] of enumChecks) {
    const value = obj[field];
    if (value != null && !allowed.includes(value as string)) {
      return { error: `Invalid ${field}: ${String(value)}` };
    }
  }
  if (obj.year != null) {
    if (
      typeof obj.year !== "number" ||
      !Number.isInteger(obj.year) ||
      obj.year < 2000 ||
      obj.year > 2100
    ) {
      return { error: "year must be a 4-digit year" };
    }
  }
  if (obj.special != null && typeof obj.special !== "boolean") {
    return { error: "special must be a boolean" };
  }
  if (obj.story != null) {
    const err = storyError(obj.story);
    if (err) return { error: err };
  }
  if (obj.sources != null) {
    const err = sourcesError(obj.sources);
    if (err) return { error: err };
  }

  // proof is the server's to count (job-proof.ts): a request body never sets it.
  return { meta: { ...parseJobMeta(obj), proof: null } };
}

/**
 * The save-time rule for a published story on an anonymized job that names
 * the client (serializeJob withholds such a story regardless):
 *  - newly publishing it, or editing its text while published, is REFUSED,
 *    with the matched word, so the form can never claim a story is live that
 *    the site will not show;
 *  - a story that was ALREADY published, unchanged, is moved back to DRAFT
 *    and the save goes through. That is the "client asked to be anonymized"
 *    save: refusing it would keep `anonymize` false and the client's name on
 *    the live site (second review, 2026-11-23).
 */
export function guardPublishedStory(
  meta: JobMeta,
  stored: JobMeta
): { meta: JobMeta; notice: string | null } | { error: string } {
  const match = storyClientMatch(meta);
  if (!match || meta.story?.status !== "published") return { meta, notice: null };
  // Anything already live goes back to draft rather than being refused, even
  // if its text was edited in the same save: the save that turns on
  // anonymize must never be the one that fails (third review, 2026-11-23).
  const wasLive = stored.story?.status === "published";
  if (!wasLive) {
    return {
      error: `This story mentions the client ("${match}"), and the job is anonymized. Take that out to publish it.`,
    };
  }
  return {
    meta: { ...meta, story: { ...meta.story, status: "draft" } },
    notice: `The story mentions the client ("${match}"), so it went back to draft and is off the site. Edit it, then publish again.`,
  };
}

/** The case-study fields (2026-11-23), which older clients do not send. */
export const CASE_STUDY_KEYS = ["special", "story", "sources"] as const;

/**
 * A job save replaces the whole document, so a body that OMITS a case-study
 * field keeps the stored value: a browser tab opened before these fields
 * existed, or any partial writer, would otherwise erase a published story
 * and its proof with a 200 (review, 2026-11-23). Sending null (or [] / false)
 * still changes the field on purpose. Non-objects pass through for the
 * validator to reject.
 */
export function keepOmittedCaseStudyFields(input: unknown, stored: JobMeta): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const merged: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of CASE_STUDY_KEYS) if (!(key in merged)) merged[key] = stored[key];
  return merged;
}

/* ─── Completeness (draft vs live) ─── */

/**
 * Human-labeled list of required fields still missing — empty means the job
 * is API-complete. Required per the site's Job contract: client (or alias
 * when anonymized), city, ≥1 service, event size, duration, teams, industry
 * (+ the free-text industry when "other").
 */
export function jobMissingFields(meta: JobMeta): string[] {
  const missing: string[] = [];
  if (!meta.client) missing.push("client");
  if (meta.anonymize && !meta.alias) missing.push("alias");
  if (!meta.city) missing.push("city");
  if (meta.services.length === 0) missing.push("services");
  if (!meta.eventSize) missing.push("event size");
  if (!meta.duration) missing.push("duration");
  if (!meta.teams) missing.push("team size");
  if (!meta.industry) missing.push("industry");
  if (meta.industry === "other" && !meta.industryOther) missing.push("industry name");
  return missing;
}

export function isJobComplete(meta: JobMeta): boolean {
  return jobMissingFields(meta).length === 0;
}

/* ─── API serialization ─── */

/**
 * The job's public metadata, exactly as GET /api/site/jobs returns it
 * (sans images). The anonymity contract is enforced HERE, in one place:
 * anonymized jobs serialize client = null (the name never leaves the
 * server) and only anonymized jobs serialize an alias (the site renders
 * `alias ?? client`, so a stray alias would mask a public client name).
 */
export function serializeJob(slug: string, meta: JobMeta) {
  return {
    slug,
    client: meta.anonymize ? null : meta.client,
    alias: meta.anonymize ? meta.alias : null,
    // Free text the editor typed: on an anonymized job a field that names the
    // client is dropped rather than sent ("Rand Technology Summit").
    eventName: anonymizedText(meta, meta.eventName),
    city: meta.city,
    venue: anonymizedText(meta, meta.venue),
    services: meta.services,
    eventSize: meta.eventSize,
    duration: meta.duration,
    teams: meta.teams,
    ballpark: meta.ballpark,
    industry: meta.industry,
    industryOther: meta.industry === "other" ? meta.industryOther : null,
    year: meta.year,
    // Always a boolean in API output — unset/legacy stored docs read false.
    touchups: meta.touchups,
    special: meta.special,
    // Drafts never leave the server, and neither does a story that names an
    // anonymized client (fail closed: the job page simply has no story).
    story:
      meta.story && meta.story.status === "published" && !storyClientMatch(meta)
        ? {
            headline: meta.story.headline,
            dek: meta.story.dek,
            body: meta.story.body,
            quote: meta.story.quote,
          }
        : null,
    // Counts only: source gallery ids and names stay on the server.
    proof:
      meta.proof && meta.proof.photos > 0 && meta.proof.galleries > 0
        ? {
            photos: meta.proof.photos,
            galleries: meta.proof.galleries,
            people: meta.proof.people,
            days: meta.proof.days,
          }
        : null,
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words in a company name that identify nobody: legal forms and generic
    business nouns ("Rand Technology" is identified by "Rand", not "Technology"). */
const GENERIC_NAME_WORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp", "ltd", "limited", "plc",
  "gmbh", "ag", "sa", "se", "bv", "nv", "the", "and", "of", "group", "holdings", "technology",
  "technologies", "tech", "systems", "solutions", "software", "labs", "global", "international",
  "services", "partners", "com", "net", "org", "io", "ai", "events", "media", "health",
]);

/** Letters NFD does not split into base + accent ("Ørsted" = "Orsted"). */
const FOLD: Record<string, string> = {
  ø: "o", Ø: "O", ß: "ss", ł: "l", Ł: "L", đ: "d", Đ: "D", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", þ: "th", Þ: "Th",
};
const deaccent = (s: string) =>
  s.replace(/[øØßłŁđĐæÆœŒþÞ]/g, (c) => FOLD[c]).normalize("NFD").replace(/\p{M}+/gu, "");
const squeeze = (s: string) => deaccent(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Legal forms and joiners: never part of initials ("Ernst & Young LLP" → "EY"). */
const LEGAL_WORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp", "ltd", "limited", "plc",
  "gmbh", "ag", "sa", "se", "bv", "nv", "the", "and", "of", "com", "net", "org", "io",
]);

/**
 * The word or form of `client` found in `text`, or null. Matching, all
 * case- and accent-insensitive ("Nestlé" = "Nestle"):
 *  - the full name, and every distinctive word of it, as WHOLE words: "HP
 *    Inc." catches "HP's", "Salesforce, Inc." catches "Salesforce", and
 *    "Rand" does not match "brand";
 *  - squeezed forms (spaces and punctuation removed, 6+ letters) anywhere:
 *    "ServiceNow" vs "Service Now's", "Coca-Cola" vs "CocaCola", "PayPal" vs
 *    "Pay Pal", "JPMorgan" vs "J.P. Morgan";
 *  - the initials of a multi-word name as a whole word: "General Electric"
 *    catches "GE", "Ernst & Young" catches "EY".
 * Over-matching only withholds (and the form names the word it matched);
 * under-matching would publish a name the client asked us to keep off the
 * site. History: the first version checked the full name and its first word;
 * two reviews on 2026-11-23 found the forms above.
 */
export function clientNameMatch(client: string | null, text: string | null): string | null {
  if (!client || !text) return null;
  const name = client.trim();
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const distinctive = words.filter((w) => w.length >= 2 && !GENERIC_NAME_WORDS.has(w.toLowerCase()));
  const plain = deaccent(text);
  const B = "[^\\p{L}\\p{N}]"; // a word boundary that understands accented letters

  const matches = (needle: string) => {
    const letters = deaccent(needle).replace(/[^\p{L}\p{N}]+/gu, "");
    if (!letters) return false;
    if (letters.length <= 3) {
      // Short forms ("HP", "IBM", "A&E", initials) may be written with
      // separators ("I.B.M.", "A & E", "P&G"), and as lowercase they are
      // ordinary English ("it", "on", "at"), so they match case-sensitively
      // unless the client itself writes them in lowercase.
      const body = [...letters].map(escapeRegExp).join("[\\s.&'\u2019-]*");
      const flags = /\p{Ll}/u.test(letters) ? "iu" : "u";
      return new RegExp(`(^|${B})${body}($|${B})`, flags).test(plain);
    }
    return new RegExp(`(^|${B})${escapeRegExp(deaccent(needle))}($|${B})`, "iu").test(plain);
  };

  const needles = [name, ...distinctive];
  const initials = words
    .filter((w) => !LEGAL_WORDS.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join("");
  if (words.length >= 2 && initials.length >= 2) needles.push(initials);
  const hit = needles.find(matches);
  if (hit) return hit;

  const squeezedText = squeeze(text);
  const squeezedForms = [...distinctive.map(squeeze), squeeze(distinctive.join(""))];
  const form = squeezedForms.find((f) => f.length >= 6 && squeezedText.includes(f));
  return form ?? null;
}

/** On an anonymized job: the client word a published-facing story contains. */
export function storyClientMatch(meta: JobMeta): string | null {
  if (!meta.anonymize || !meta.story) return null;
  const q = meta.story.quote;
  return clientNameMatch(
    meta.client,
    [meta.story.headline, meta.story.dek, meta.story.body, q?.text, q?.by, q?.role].filter(Boolean).join("\n")
  );
}

export function storyNamesClient(meta: JobMeta): boolean {
  return storyClientMatch(meta) !== null;
}

/** Free text sent for an anonymized job: dropped when it names the client. */
function anonymizedText(meta: JobMeta, value: string | null): string | null {
  return meta.anonymize && clientNameMatch(meta.client, value) ? null : value;
}

/* ─── Slugs ─── */

/** "ServiceNow Knowledge 25" → "servicenow-knowledge-25". */
export function jobSlugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics (post-NFKD)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "job";
}

export function isValidJobSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/* ─── Smart suggestions (editor prefills — always editable, never authoritative) ─── */

interface KnownClient {
  industry: JobIndustry;
  industryOther?: string;
  alias: string;
}

/** Lookup key: lowercase, alphanumerics only ("Coca-Cola" → "cocacola"). */
function normalizeClientName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Well-known brands → industry + a sharper anonymized alias. Tiny and
 * curated on purpose: a hit is delightful, a miss falls back to the
 * composed suggestion. Keys are normalized client names.
 */
const KNOWN_CLIENTS: Record<string, KnownClient> = {
  // Tech
  google: { industry: "tech", alias: "Fortune 100 tech company" },
  alphabet: { industry: "tech", alias: "Fortune 100 tech company" },
  microsoft: { industry: "tech", alias: "Fortune 100 tech company" },
  apple: { industry: "tech", alias: "Fortune 100 tech company" },
  amazon: { industry: "tech", alias: "Fortune 100 tech company" },
  meta: { industry: "tech", alias: "Fortune 100 tech company" },
  facebook: { industry: "tech", alias: "Fortune 100 tech company" },
  nvidia: { industry: "tech", alias: "Fortune 100 tech company" },
  intel: { industry: "tech", alias: "Fortune 100 tech company" },
  ibm: { industry: "tech", alias: "Fortune 100 tech company" },
  oracle: { industry: "tech", alias: "Enterprise software company" },
  salesforce: { industry: "tech", alias: "Enterprise software company" },
  servicenow: { industry: "tech", alias: "Enterprise software company" },
  adobe: { industry: "tech", alias: "Enterprise software company" },
  cisco: { industry: "tech", alias: "Enterprise tech company" },
  stripe: { industry: "tech", alias: "Global fintech company" },
  openai: { industry: "tech", alias: "Leading AI company" },
  anthropic: { industry: "tech", alias: "Leading AI company" },
  uber: { industry: "tech", alias: "Global tech platform" },
  lyft: { industry: "tech", alias: "Global tech platform" },
  airbnb: { industry: "tech", alias: "Global tech platform" },
  linkedin: { industry: "tech", alias: "Global professional network" },
  tiktok: { industry: "tech", alias: "Global social media company" },
  spotify: { industry: "tech", alias: "Global music streaming company" },
  // Finance
  jpmorgan: { industry: "finance", alias: "Fortune 100 financial services firm" },
  jpmorganchase: { industry: "finance", alias: "Fortune 100 financial services firm" },
  chase: { industry: "finance", alias: "Fortune 100 financial services firm" },
  goldmansachs: { industry: "finance", alias: "Global investment bank" },
  morganstanley: { industry: "finance", alias: "Global investment bank" },
  bankofamerica: { industry: "finance", alias: "Fortune 100 financial services firm" },
  wellsfargo: { industry: "finance", alias: "Fortune 100 financial services firm" },
  visa: { industry: "finance", alias: "Global payments company" },
  mastercard: { industry: "finance", alias: "Global payments company" },
  americanexpress: { industry: "finance", alias: "Global payments company" },
  amex: { industry: "finance", alias: "Global payments company" },
  fidelity: { industry: "finance", alias: "Major investment firm" },
  blackrock: { industry: "finance", alias: "Major investment firm" },
  // Healthcare
  pfizer: { industry: "healthcare", alias: "Fortune 100 pharmaceutical company" },
  moderna: { industry: "healthcare", alias: "Major pharmaceutical company" },
  johnsonjohnson: { industry: "healthcare", alias: "Fortune 100 healthcare company" },
  unitedhealth: { industry: "healthcare", alias: "Fortune 100 healthcare company" },
  unitedhealthcare: { industry: "healthcare", alias: "Fortune 100 healthcare company" },
  kaiserpermanente: { industry: "healthcare", alias: "Major healthcare provider" },
  // Retail
  nike: { industry: "retail", alias: "Global athletic-wear brand" },
  lululemon: { industry: "retail", alias: "Global athletic-wear brand" },
  walmart: { industry: "retail", alias: "Fortune 100 retailer" },
  target: { industry: "retail", alias: "Fortune 100 retailer" },
  costco: { industry: "retail", alias: "Fortune 100 retailer" },
  homedepot: { industry: "retail", alias: "Fortune 100 retailer" },
  // Food & beverage (site enum has no food-bev — lands on other + free text)
  cocacola: { industry: "other", industryOther: "Food & beverage", alias: "Fortune 100 beverage company" },
  coke: { industry: "other", industryOther: "Food & beverage", alias: "Fortune 100 beverage company" },
  pepsi: { industry: "other", industryOther: "Food & beverage", alias: "Fortune 100 beverage company" },
  pepsico: { industry: "other", industryOther: "Food & beverage", alias: "Fortune 100 beverage company" },
  redbull: { industry: "other", industryOther: "Food & beverage", alias: "Global beverage brand" },
  starbucks: { industry: "other", industryOther: "Food & beverage", alias: "Global coffee brand" },
  // Entertainment
  disney: { industry: "entertainment", alias: "Major entertainment studio" },
  netflix: { industry: "entertainment", alias: "Major streaming entertainment company" },
  warnerbros: { industry: "entertainment", alias: "Major entertainment studio" },
  paramount: { industry: "entertainment", alias: "Major entertainment studio" },
  sony: { industry: "entertainment", alias: "Global electronics and entertainment company" },
  universal: { industry: "entertainment", alias: "Major entertainment studio" },
  // Nonprofit
  redcross: { industry: "nonprofit", alias: "International humanitarian nonprofit" },
  gatesfoundation: { industry: "nonprofit", alias: "Major philanthropic foundation" },
  unitedway: { industry: "nonprofit", alias: "Major nonprofit organization" },
  // Automotive (no enum — other + free text)
  tesla: { industry: "other", industryOther: "Automotive", alias: "Major EV manufacturer" },
  toyota: { industry: "other", industryOther: "Automotive", alias: "Global automotive brand" },
  ford: { industry: "other", industryOther: "Automotive", alias: "Global automotive brand" },
  generalmotors: { industry: "other", industryOther: "Automotive", alias: "Global automotive brand" },
  boeing: { industry: "other", industryOther: "Aerospace", alias: "Major aerospace manufacturer" },
};

/** Industry (+ free text when "other") suggested by a known client name. */
export function suggestIndustryForClient(
  client: string
): { industry: JobIndustry; industryOther: string | null } | null {
  const known = KNOWN_CLIENTS[normalizeClientName(client)];
  if (!known) return null;
  return { industry: known.industry, industryOther: known.industryOther ?? null };
}

const SIZE_ADJECTIVES: Record<JobEventSize, string> = {
  "under-500": "Boutique",
  "500-2000": "Mid-size",
  "2000-10000": "Enterprise",
  "10000-plus": "Enterprise",
};

/**
 * Anonymized-alias suggestion: a known client gets its curated alias;
 * otherwise compose from event size + industry ("Enterprise tech client").
 * A prefill only — the form always lets the team write their own.
 */
export function suggestAlias(meta: JobMeta): string {
  if (meta.client) {
    const known = KNOWN_CLIENTS[normalizeClientName(meta.client)];
    if (known) return known.alias;
  }
  const sizeAdj = meta.eventSize ? SIZE_ADJECTIVES[meta.eventSize] : null;
  const industryNoun =
    meta.industry === "other"
      ? meta.industryOther?.toLowerCase() ?? null
      : meta.industry;
  if (sizeAdj && industryNoun) return `${sizeAdj} ${industryNoun} client`;
  if (industryNoun) {
    return `${industryNoun.charAt(0).toUpperCase()}${industryNoun.slice(1)} client`;
  }
  if (sizeAdj) return `${sizeAdj} client`;
  return "Private client";
}
