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
}

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
  };
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

  return { meta: parseJobMeta(obj) };
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
    eventName: meta.eventName,
    city: meta.city,
    venue: meta.venue,
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
  };
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
