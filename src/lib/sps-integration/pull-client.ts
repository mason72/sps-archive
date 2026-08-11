/**
 * The SimplePhotoShare pull API, as this codebase sees it.
 *
 * Pixeltrunk PULLS; SPS never pushes. Full contract:
 * `tasks/sps-archive-pull-spec.md` (written from the SPS side and current).
 *
 * Three rules this module exists to enforce, because each has a silent failure
 * mode:
 *
 *  1. **Page until `nextOffset` is absent.** Never trust `event.imageCount` —
 *     it counts the AI copies (`source_image_id` set) that the manifest
 *     deliberately excludes, so using it as a denominator declares an import
 *     incomplete forever, or complete too early.
 *  2. **`quality` is reported, never inferred.** SPS's own `IMAGE_SIZES` still
 *     reads `quality: 95` because that encoder runs for the cases its
 *     passthrough branch excludes — reading the config gives the wrong answer
 *     for the common case. The field is the answer.
 *  3. **The token never leaves this module's request headers.** It is a stored
 *     plaintext credential (SPS keeps only a hash and cannot re-display it), so
 *     it must not reach a log line, an error message, a `system_errors` detail
 *     blob, or a process argument.
 *
 * There is deliberately no `fileSize` in the manifest: SPS's `images.file_size`
 * sums all six variants and is ~3x the object behind `url`. Take the length
 * from the download.
 */

const DEFAULT_BASE_URL =
  "https://admin2.simplephotoshare.com/api/integrations/archive";

/** Images per manifest page — set by SPS, not negotiable. */
export const MANIFEST_PAGE_SIZE = 500;

/** Max ids SPS accepts in one /pulled call. */
export const PULLED_BATCH_LIMIT = 500;

function baseUrl(): string {
  return (process.env.SPS_ARCHIVE_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

/** Camera file, or the q95 re-encode. Reported by SPS per image. */
export type SpsImageQuality = "archive" | "lossy";

export interface SpsPullEvent {
  id: string;
  name: string;
  slug: string | null;
  completedAt: string | null;
  /** Includes AI copies — display only. NEVER a completion denominator. */
  imageCount: number | null;
  archiveEnabled: boolean;
  /**
   * SPS's public cover thumbnail, for the import list. Optional because it
   * post-dates the original contract; null on events that never had one set.
   */
  coverUrl?: string | null;
}

export interface SpsManifestImage {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  capturedAt: string | null;
  boothId: string | null;
  quality: SpsImageQuality;
  alreadyPulled: boolean;
  /** Full-resolution source. Expires in 1 hour when it is a presigned URL. */
  url: string;
  /**
   * Small preview for the review grid, when SPS sends one. Optional because it
   * post-dates the original contract: without it the review UI falls back to
   * proxying `url` through this server, which works but pulls the whole event
   * through Vercel just to draw thumbnails.
   */
  thumbUrl?: string | null;
}

export interface SpsManifestPage {
  event: SpsPullEvent & { date: string | null };
  images: SpsManifestImage[];
  /** Absent on the last page. A short page is the terminator. */
  nextOffset?: number;
}

export type SpsPullErrorKind =
  | "unauthorized"
  | "not-found"
  | "rate-limited"
  | "server"
  | "network";

/**
 * A failed SPS call, classified so callers can tell "re-paste your token" from
 * "try again later" without parsing strings. Carries no request detail — see
 * rule 3 above.
 */
export class SpsPullError extends Error {
  readonly kind: SpsPullErrorKind;
  readonly status: number | null;

  constructor(kind: SpsPullErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "SpsPullError";
    this.kind = kind;
    this.status = status;
  }

  /** Retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === "server" || this.kind === "network" || this.kind === "rate-limited";
  }
}

function classify(status: number, body: string): SpsPullError {
  if (status === 401) {
    return new SpsPullError(
      "unauthorized",
      status,
      "SPS rejected the connection token. Re-mint it in SPS and paste it again."
    );
  }
  if (status === 404) {
    // SPS answers 404 rather than 403 for another host's event on purpose — it
    // refuses to confirm the event exists. So this genuinely means "not yours
    // or not there", and the two are indistinguishable by design.
    return new SpsPullError(
      "not-found",
      status,
      "SPS has no such event for this connection."
    );
  }
  if (status === 429) {
    return new SpsPullError("rate-limited", status, "SPS rate-limited the request.");
  }
  return new SpsPullError(
    "server",
    status,
    `SPS returned ${status}${body ? `: ${body.slice(0, 200)}` : ""}`
  );
}

/** Every call goes through here, so the token has exactly one code path. */
async function call<T>(
  token: string,
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-SPS-Archive-Token": token,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
      cache: "no-store",
    });
  } catch (err) {
    // Network/abort. The message can safely be surfaced; it never contains the
    // header we sent.
    throw new SpsPullError(
      "network",
      null,
      `Could not reach SPS: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    throw classify(res.status, await res.text().catch(() => ""));
  }

  return (await res.json()) as T;
}

/**
 * Events available to pull: this host's COMPLETED events, newest first.
 *
 * Doubles as the token validator — the connection screen calls this on save so
 * a truncated paste fails at the paste rather than at the first import.
 */
export async function listSpsEvents(token: string): Promise<SpsPullEvent[]> {
  const data = await call<{ events: SpsPullEvent[] }>(token, "/events");
  return data.events ?? [];
}

/** One manifest page. `offset` must be a multiple of MANIFEST_PAGE_SIZE. */
export async function fetchManifestPage(
  token: string,
  spsEventId: string,
  offset = 0
): Promise<SpsManifestPage> {
  return call<SpsManifestPage>(
    token,
    `/events/${spsEventId}/manifest?offset=${offset}`,
    // A page presigns up to 500 URLs server-side; give it room.
    { timeoutMs: 60_000 }
  );
}

/**
 * Walk every manifest page, calling back per page.
 *
 * Pages until `nextOffset` is absent (see rule 1). The callback may stop the
 * walk by returning `false` — used by the importer to hand control back
 * before it accumulates too much work in one Inngest run.
 */
export async function walkManifest(
  token: string,
  spsEventId: string,
  onPage: (page: SpsManifestPage, offset: number) => Promise<boolean | void>,
  startOffset = 0
): Promise<{ stoppedAt: number | null; complete: boolean }> {
  let offset = startOffset;

  for (;;) {
    const page = await fetchManifestPage(token, spsEventId, offset);
    const keepGoing = await onPage(page, offset);

    if (page.nextOffset === undefined) {
      return { stoppedAt: null, complete: true };
    }
    if (keepGoing === false) {
      return { stoppedAt: page.nextOffset, complete: false };
    }
    offset = page.nextOffset;
  }
}

/**
 * Tell SPS the bytes are durable here, which is what makes its own copy
 * eligible for deletion.
 *
 * ⚠️ ORDERING — the one call that can lose data. Only ever invoked AFTER the
 * bytes are written and the row is complete on this side. Confirming on receipt
 * instead would leave an archive that believes it holds a file it never
 * persisted, with SPS's copy already released.
 *
 * `confirmed` counts only rows that had a separate archive copy to release, so
 * a passthrough image confirming as 0 is correct and not an error.
 */
export async function confirmPulled(
  token: string,
  spsEventId: string,
  imageIds: string[]
): Promise<number> {
  let confirmed = 0;
  for (let i = 0; i < imageIds.length; i += PULLED_BATCH_LIMIT) {
    const chunk = imageIds.slice(i, i + PULLED_BATCH_LIMIT);
    const data = await call<{ confirmed: number }>(
      token,
      `/events/${spsEventId}/pulled`,
      { method: "POST", body: { imageIds: chunk }, timeoutMs: 60_000 }
    );
    confirmed += data.confirmed ?? 0;
  }
  return confirmed;
}
