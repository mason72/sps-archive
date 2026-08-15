"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { AppNav } from "@/components/layout/AppNav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
import { ElephantWalk } from "@/components/brand/ElephantWalk";
import {
  GigIntelStep,
  type GigIntelPayload,
} from "@/components/events/CreateGigConfirm";
import { CrewFaceTag } from "@/components/crew/CrewFaceTag";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Camera,
  Loader2,
  Search,
  ImageOff,
  X,
} from "lucide-react";

/**
 * Import an event from SimplePhotoShare.
 *
 * Three screens in one route: pick an event, review its photos, watch the pull.
 *
 * The review step is the point of this page, not decoration. An SPS gallery is
 * the LIVE FEED of a shoot — setup frames, test shots, lens calibration, the
 * lighting check against a wall. The archive is the curated version. A previous
 * one-off backfill imported four setup photos Mason had already deleted because
 * it treated a curation gap as a data gap.
 *
 * Selection is held as an EXCLUSION set: everything is checked by default and
 * unchecking adds to `deselected`. That way the import means "everything except
 * these", regardless of how many manifest pages the grid has loaded — an
 * inclusion list would quietly import only what had scrolled into view.
 */

interface SpsEventRow {
  id: string;
  name: string;
  completedAt: string | null;
  imageCount: number | null;
  archiveEnabled: boolean;
  /** Still live on SPS — importable, badged, and confirmed before pulling. */
  live?: boolean;
  /** SPS's cover thumbnail, when the event has one. */
  coverUrl: string | null;
  archiveEventId: string | null;
  job: {
    id: string;
    status: string;
    imagesDone: number;
    expectedTotal: number | null;
  } | null;
}

interface ManifestImage {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  quality: "archive" | "lossy";
  alreadyPulled: boolean;
  previewUrl: string;
  previewIsFullSize: boolean;
  /** Camera-size source, for tag-at-import — a thumb makes a bad reference. */
  fullUrl: string;
}

interface PullJob {
  id: string;
  event_id: string;
  sps_event_name: string | null;
  status: string;
  expected_total: number | null;
  images_done: number;
  images_failed: number;
  images_skipped: number;
  bytes_copied: number;
  confirmed: number;
  failures: { filename?: string; reason?: string }[];
  error: string | null;
  finished_at: string | null;
  /** Photos actually in the event — the authoritative count, from the rows. */
  landed: number;
  /** Photos SPS has been told about (not the same as ones it could release). */
  reported: number;
  /** Thumbnails of what has landed. Only populated when asked for. */
  thumbs?: string[];
}

type Stage = "pick" | "review" | "running";

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ImportFromSpsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("pick");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<SpsEventRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Review state
  const [chosen, setChosen] = useState<SpsEventRow | null>(null);
  const [images, setImages] = useState<ManifestImage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [isPaging, setIsPaging] = useState(false);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = useState(false);

  /**
   * The calendar gig this import is, confirmed here rather than later.
   *
   * An import mints an event exactly as the create screen does, so it had the
   * identical gap: the venue, the crew and the client existed on the calendar
   * and nothing asked. This is also the moment Mason named as the right one for
   * rating a local hire — "the lead from the event is uploading just after
   * working with them."
   */
  const [gigIntel, setGigIntel] = useState<GigIntelPayload | null>(null);
  /** The last "saved a crew face" confirmation — shown by the import button. */
  const [tagNote, setTagNote] = useState<string | null>(null);
  /**
   * The SHOOT day, taken from the manifest's event record.
   *
   * Not `completedAt`: an SPS event is marked complete whenever the shoot is
   * wrapped up, which can be days later, and the calendar window is centred on
   * the day it is given.
   */
  const [spsShootDate, setSpsShootDate] = useState<string | null>(null);

  // Progress state
  const [job, setJob] = useState<PullJob | null>(null);
  /** The last poll didn't land — say so rather than showing a stale number. */
  const [pollStale, setPollStale] = useState(false);

  // Event-list search. 84 completed events is too many to scan by eye.
  const [eventQuery, setEventQuery] = useState("");

  /**
   * Manual linking — "these were uploaded manually; I'd like to mark them as
   * 'already in the system'" (Mason, 2026-08-15). One picker open at a time;
   * the archive's event list is fetched once, on the first open, because
   * every row's picker offers the same list.
   */
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [ptEvents, setPtEvents] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!linkingId || ptEvents !== null) return;
    let live = true;
    fetch("/api/events?limit=200")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => {
        if (live)
          setPtEvents(
            (j.events ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))
          );
      })
      .catch(() => { if (live) setPtEvents([]); });
    return () => { live = false; };
  }, [linkingId, ptEvents]);

  const markLinked = (spsId: string, archiveEventId: string | null) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === spsId ? { ...e, archiveEventId } : e))
    );
    setLinkingId(null);
  };

  const unlink = async (ev: SpsEventRow) => {
    if (
      !window.confirm(
        `Unlink “${ev.name}” from its archive event? Nothing is deleted — the import list will just offer it again.`
      )
    )
      return;
    const res = await fetch(`/api/sps/pull/events/${ev.id}/link`, { method: "DELETE" });
    if (res.ok) markLinked(ev.id, null);
  };

  /**
   * Read by the poll callback, which must NOT depend on `images` — rebuilding it
   * on every manifest page would cancel and restart the poll mid-import.
   */
  const imagesRef = useRef<ManifestImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  /** Which slice of the event's photos is currently drifting past the elephant. */
  const [photoWindow, setPhotoWindow] = useState(0);

  /**
   * Thumbnails of photos already imported, fetched only when the review grid was
   * never loaded — the revisit case. Keeps the loader showing real photographs
   * instead of an empty savanna, which is the state you land in if you come back
   * to a long import from the event list.
   */
  const [landedThumbs, setLandedThumbs] = useState<string[]>([]);
  /** Same reason as imagesRef: the poll callback must stay stable. */
  const landedThumbsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!user) router.push("/login");
  }, [user, router]);

  // ── Event list ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sps/pull/events");
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error || "Could not reach SimplePhotoShare.");
          return;
        }
        setConnected(data.connected);
        setEvents(data.events || []);
      } catch {
        setLoadError("Could not reach SimplePhotoShare.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── Manifest paging ──
  const loadPage = useCallback(
    async (spsEventId: string, offset: number) => {
      setIsPaging(true);
      try {
        const res = await fetch(
          `/api/sps/pull/events/${spsEventId}/manifest?offset=${offset}`
        );
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error || "Could not read the SPS manifest.");
          setNextOffset(null);
          return;
        }
        setImages((prev) => [...prev, ...(data.images as ManifestImage[])]);
        setNextOffset(data.nextOffset ?? null);
        // SPS's `date` is a timestamp; the calendar lookup wants a day.
        const day = (data.event?.date as string | null | undefined)?.slice(0, 10);
        if (day) setSpsShootDate(day);
      } catch {
        setLoadError("Could not read the SPS manifest.");
        setNextOffset(null);
      } finally {
        setIsPaging(false);
      }
    },
    []
  );

  /**
   * Continue a stopped import. Deliberately does NOT re-open review: the
   * deselections were chosen once, and the server resumes the existing job
   * rather than interpreting a fresh selection against photos already imported.
   */
  const resumeImport = async (ev: SpsEventRow) => {
    setLoadError(null);
    try {
      const res = await fetch("/api/sps/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spsEventId: ev.id }),
      });
      const data = await res.json();
      if (!res.ok && !data.jobId) {
        setLoadError(data.error || "Could not resume the import.");
        return;
      }
      setStage("running");
      pollJob(data.jobId);
    } catch {
      setLoadError("Could not resume the import.");
    }
  };

  const beginReview = (ev: SpsEventRow) => {
    setChosen(ev);
    setImages([]);
    setDeselected(new Set());
    setNextOffset(0);
    setLoadError(null);
    setStage("review");
    setManifestTotal(null);
    setCountPending(true);
    setGigIntel(null);
    setTagNote(null);
    setSpsShootDate(ev.completedAt ? ev.completedAt.slice(0, 10) : null);
    loadPage(ev.id, 0);

    // Count the whole manifest in parallel with the first page, so the screen can
    // state a real total instead of describing how far the grid has scrolled.
    (async () => {
      try {
        const res = await fetch(`/api/sps/pull/events/${ev.id}/count`);
        if (res.ok) {
          const { total, complete } = await res.json();
          if (complete) setManifestTotal(total);
        }
      } catch {
        /* Non-fatal: the screen falls back to "everything", and the job counts
           the total itself once the import starts. */
      } finally {
        setCountPending(false);
      }
    })();
  };

  // Auto-page as the photographer scrolls the grid.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (stage !== "review" || nextOffset === null || isPaging || !chosen) return;
    const node = sentinelRef.current;
    if (!node) return;

    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadPage(chosen.id, nextOffset);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [stage, nextOffset, isPaging, chosen, loadPage]);

  const toggle = (id: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Case-insensitive substring on the event name — the only field worth matching. */
  const visibleEvents = useMemo(() => {
    const q = eventQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) => ev.name.toLowerCase().includes(q));
  }, [events, eventQuery]);

  /**
   * Photos to drift past the elephant while the pull runs.
   *
   * Drawn from the manifest previews the review grid already fetched, and only
   * from the SELECTED ones — a photo the photographer just unchecked has no
   * business parading through the import of everything else. Spread across the
   * event rather than taken from the front, so a 6,000-frame pull doesn't show
   * the same six faces for an hour.
   */
  const passingPhotos = useMemo(() => {
    const kept = images.filter((i) => !deselected.has(i.id));
    // Revisit: no manifest in memory, so walk him through what has already landed.
    if (!kept.length) return landedThumbs;
    // Only four are on the road at a time (one per band per copy), so hand over
    // a small rotating window rather than the whole event — and rotate it, or a
    // 40-minute pull shows the same two frames for 40 minutes.
    const step = Math.max(1, Math.floor(kept.length / 12));
    return Array.from({ length: 4 }, (_, i) => {
      const idx = ((photoWindow + i) * step) % kept.length;
      return kept[idx].previewUrl;
    });
  }, [images, deselected, photoWindow, landedThumbs]);

  // Advance the window on a SLOW clock. The bands loop every 15s (near) and 38s
  // (far), and a swap while a card is mid-screen is visible — the same class of
  // glitch as the two copies disagreeing. 45s means most changes land while the
  // road is empty, and a card is only on screen for a fraction of each pass.
  useEffect(() => {
    if (stage !== "running") return;
    const t = setInterval(() => setPhotoWindow((w) => w + 1), 45_000);
    return () => clearInterval(t);
  }, [stage]);

  /**
   * The REAL number of photos in the SPS event, counted server-side across every
   * manifest page. The grid's own length is a scroll position, not a total —
   * showing it beside the import button read as the scope of the import.
   */
  const [manifestTotal, setManifestTotal] = useState<number | null>(null);
  const [countPending, setCountPending] = useState(false);

  /** Manifest pages are still arriving, so no count on screen can be the total. */
  const stillLoading = nextOffset !== null;

  /**
   * What the import will actually move: the counted manifest total minus the
   * exclusion set, or null while the count is still in flight. NOT derived from
   * `images.length`, which is only how far the grid has been scrolled.
   */
  const importCount =
    manifestTotal !== null ? manifestTotal - deselected.size : null;

  const lossyCount = images.filter(
    (i) => i.quality === "lossy" && !deselected.has(i.id)
  ).length;

  const startImport = async () => {
    if (!chosen) return;
    /**
     * A live event imports with EYES OPEN — Mason's own design for lifting the
     * completed-only gate: "a LIVE badge and 'are you sure' warning would do
     * the same work without blocking me." The fact that matters is in the
     * wording: an event imports once, and photos arriving after this moment
     * are not in the copy.
     */
    if (
      chosen.live &&
      !window.confirm(
        `“${chosen.name}” is still live on SPS. An event can only be imported once, and photos that arrive after this moment won't be included. Import what's there now?`
      )
    ) {
      return;
    }
    setIsStarting(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/sps/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spsEventId: chosen.id,
          deselected: [...deselected],
          // Display-only denominator. The server decides completion from the
          // manifest, never from this.
          // The counted total, not the scrolled-through count.
          expectedTotal: importCount,
          // Written after the event exists and never able to fail the import —
          // see the tail of the route.
          intel: gigIntel ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || "Could not start the import.");
        if (data.jobId) {
          setStage("running");
          pollJob(data.jobId);
        }
        return;
      }
      setStage("running");
      pollJob(data.jobId);
    } catch {
      setLoadError("Could not start the import.");
    } finally {
      setIsStarting(false);
    }
  };

  // ── Progress polling ──
  //
  // Keeps polling until it sees a TERMINAL status. The previous version only
  // rescheduled on a successful response, so one blip — a 500, a dropped
  // connection, a sleeping laptop — silently ended the watch and the screen
  // froze at whatever it last saw. A frozen number is indistinguishable from a
  // stalled import, which is exactly how the first real import read.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollJob = useCallback(async (jobId: string, failures = 0) => {
    const again = (delay: number, nextFailures: number) => {
      pollTimer.current = setTimeout(() => pollJob(jobId, nextFailures), delay);
    };

    try {
      // Ask for landed thumbnails only while we have no manifest previews — i.e.
      // a revisit, where the review grid was never loaded. Once we have some,
      // stop asking.
      const wantThumbs =
        imagesRef.current.length === 0 && landedThumbsRef.current.length === 0;
      const res = await fetch(
        `/api/sps/pull/jobs/${jobId}${wantThumbs ? "?thumbs=1" : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        // Back off, but never give up while we still believe it's running.
        setPollStale(true);
        again(Math.min(3000 * 2 ** failures, 30000), failures + 1);
        return;
      }
      const { job: fresh } = (await res.json()) as { job: PullJob };
      setJob(fresh);
      setPollStale(false);
      if (fresh.thumbs?.length) {
        landedThumbsRef.current = fresh.thumbs;
        setLandedThumbs(fresh.thumbs);
      }
      if (fresh.status === "queued" || fresh.status === "running") {
        again(2500, 0);
      }
    } catch {
      setPollStale(true);
      again(Math.min(3000 * 2 ** failures, 30000), failures + 1);
    }
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    []
  );

  const cancelImport = async () => {
    if (!job) return;
    await fetch(`/api/sps/pull/jobs/${job.id}`, { method: "DELETE" });
    pollJob(job.id);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <AppNav />
      </Nav>

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-6xl w-full">
        <div className="mb-10">
          {stage === "review" ? (
            <button
              onClick={() => setStage("pick")}
              className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft size={12} />
              All SPS events
            </button>
          ) : (
            <Link
              href="/"
              className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5"
            >
              <ArrowLeft size={12} />
              Archive
            </Link>
          )}

          {stage === "pick" ? (
            /* The source, named in its own mark rather than in a sentence —
               this screen is the seam between two products and should look
               like it. */
            <div className="flex items-end gap-4 flex-wrap min-w-0">
              <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
                Import from
              </h1>
              {/* max-w-full matters: a fixed-height w-auto image keeps its
                  intrinsic width and punches out of the container on a narrow
                  window — the wordmark was clipped mid-letter at ~800px. */}
              <Image
                src="/sps-logo.png"
                alt="SimplePhotoShare"
                width={280}
                height={72}
                className="h-[clamp(26px,3.6vw,42px)] w-auto max-w-full object-contain mb-1 reveal"
                style={{ animationDelay: "0.1s" }}
                priority
              />
            </div>
          ) : (
            <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
              {stage === "review" ? chosen?.name : "Pulling camera files"}
            </h1>
          )}
          <p className="caption-italic mt-3">
            {stage === "pick" &&
              "Finished events, with their camera files still sitting on SPS."}
            {stage === "review" &&
              "Everything is selected. Uncheck the setup frames and test shots you don't want archived."}
            {stage === "running" &&
              "Files are copied a page at a time. You can leave this screen — it keeps going."}
          </p>
        </div>

        {loadError && (
          <p className="mb-8 text-[13px] text-red-600 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </p>
        )}

        {/* ─── Pick ─── */}
        {stage === "pick" && (
          <>
            {isLoading ? (
              <p className="py-24 text-center text-[13px] text-stone-400">Loading…</p>
            ) : connected === false ? (
              <div className="border border-stone-200 p-8">
                <h2 className="text-[17px] font-medium text-stone-900 mb-2">
                  SimplePhotoShare isn&apos;t connected yet
                </h2>
                <p className="text-[14px] text-stone-500 leading-[1.7] max-w-md mb-6">
                  Connect it once and finished events show up here with their
                  camera files ready to pull.
                </p>
                <BrandButton onClick={() => router.push("/settings/connections")}>
                  Set up the connection
                </BrandButton>
              </div>
            ) : events.length === 0 ? (
              <div className="border border-stone-200 p-8">
                <h2 className="text-[17px] font-medium text-stone-900 mb-2">
                  Nothing to import yet
                </h2>
                <p className="text-[14px] text-stone-500 leading-[1.7] max-w-md">
                  Events appear here once they&apos;re marked complete in SPS —
                  a live event is still being shot, and importing one would
                  archive a partial take.
                </p>
              </div>
            ) : (
              <>
                {/* Search, because 84 completed events is past the point of
                    scanning. Matches the archive's own search-bar treatment. */}
                <div className="relative mb-6 max-w-md">
                  <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-300" />
                  <input
                    type="text"
                    value={eventQuery}
                    onChange={(e) => setEventQuery(e.target.value)}
                    placeholder="Search SPS events…"
                    className="w-full pl-7 pr-8 py-2.5 text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                  />
                  {eventQuery && (
                    <button
                      onClick={() => setEventQuery("")}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-600 transition-colors cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {visibleEvents.length === 0 ? (
                  <p className="py-16 text-center text-[13px] text-stone-400">
                    No SPS events match “{eventQuery}”.
                  </p>
                ) : (
                <ul className="divide-y divide-stone-100 border-t border-b border-stone-100">
                {visibleEvents.map((ev) => {
                  const busy =
                    ev.job?.status === "running" || ev.job?.status === "queued";
                  const resumable =
                    ev.job?.status === "cancelled" || ev.job?.status === "failed";
                  return (
                    <li
                      key={ev.id}
                      className="py-5 flex items-center justify-between gap-6"
                    >
                      <div className="min-w-0 flex items-center gap-4">
                        {/* SPS's own cover, 16:9 — these are event covers, which
                            are composed wide, so a square crop cut the logo and
                            the subject out of its own key art. Cropping is fine
                            (Mason: "we croppin"); cropping to the wrong shape is
                            not. */}
                        <div className="w-28 aspect-video shrink-0 bg-stone-100 overflow-hidden flex items-center justify-center">
                          {ev.coverUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={ev.coverUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageOff size={16} className="text-stone-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[16px] text-stone-900 truncate">
                            {ev.name}
                          </h3>
                          <p className="text-[13px] text-stone-400 mt-1">
                            {/* A live event has no completed date to show, and
                                "so far" keeps the count honest — it can still
                                grow. */}
                            {ev.live ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                                  <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-600/60" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-700" />
                                  </span>
                                  LIVE
                                </span>
                                {ev.imageCount ? ` · about ${ev.imageCount} photos so far` : ""}
                              </>
                            ) : (
                              <>
                                Completed {formatDate(ev.completedAt)}
                                {ev.imageCount ? ` · about ${ev.imageCount} photos` : ""}
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      {busy ? (
                        <button
                          onClick={() => {
                            setStage("running");
                            pollJob(ev.job!.id);
                          }}
                          className="label-caps text-accent shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Loader2 size={12} className="animate-spin" />
                          Importing
                        </button>
                      ) : resumable ? (
                        // Stopped or failed part-way. Resuming continues into the
                        // event that already exists, with the deselections the
                        // first review chose — never a second event.
                        <button
                          onClick={() => resumeImport(ev)}
                          className="label-caps text-accent hover:text-accent-hover border border-accent/30 hover:border-accent px-4 py-2 shrink-0 transition-colors cursor-pointer"
                        >
                          Resume import
                        </button>
                      ) : ev.archiveEventId ? (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Link
                            href={`/events/${ev.archiveEventId}`}
                            className="label-caps text-stone-300 hover:text-stone-500 inline-flex items-center gap-1.5"
                          >
                            <Check size={12} />
                            In the archive
                          </Link>
                          {/* Only hand-made links offer undo — a link with no
                              pull job behind it was a human's claim, and a
                              claim can be retracted. A pulled event's link is
                              provenance. */}
                          {!ev.job && (
                            <button
                              onClick={() => unlink(ev)}
                              className="text-[11px] text-stone-300 transition-colors hover:text-stone-500 cursor-pointer"
                            >
                              Unlink
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="relative flex shrink-0 flex-col items-end gap-1.5">
                          <button
                            onClick={() => beginReview(ev)}
                            className="label-caps text-stone-500 hover:text-stone-900 border border-stone-200 hover:border-stone-400 px-4 py-2 transition-colors cursor-pointer"
                          >
                            Review &amp; import
                          </button>
                          {/* The uploaded-by-hand case: the photos are already
                              in the archive, they just arrived before the pull
                              lane existed. Linking marks the row rather than
                              re-importing 300 photos that are already here. */}
                          <button
                            onClick={() => setLinkingId(linkingId === ev.id ? null : ev.id)}
                            className="text-[11px] text-stone-300 transition-colors hover:text-stone-500 cursor-pointer"
                          >
                            Already in the archive?
                          </button>
                          {linkingId === ev.id && (
                            <ArchiveLinkPicker
                              spsEvent={ev}
                              ptEvents={ptEvents}
                              onLinked={(archiveEventId) => markLinked(ev.id, archiveEventId)}
                              onClose={() => setLinkingId(null)}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                </ul>
                )}
              </>
            )}
          </>
        )}

        {/* ─── Review ─── */}
        {stage === "review" && chosen && (
          <>
            {chosen.live && (
              <p className="mb-6 flex max-w-2xl items-start gap-2 text-[13px] leading-[1.7] text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  This event is still <span className="font-medium">live</span> on SPS —
                  photos may still be arriving, and an event can only be imported once.
                  What you import is what&apos;s there when the pull runs.
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-6 border-b border-stone-100">
              {/* While pages are still arriving, the client does NOT know the
                  total — and the import is an EXCLUSION set, so it will pull
                  everything regardless of how far this grid got. Printing
                  "500 of 500 selected" and "Import 500 photos" on a 9,107-photo
                  event stated a number that was simply false (Mason, on DAIS 26).
                  Say "everything" until we can say a real number. */}
              {/* Say WHAT WILL BE IMPORTED, first and plainly.
                  This line has now misled Mason twice on DAIS 26: first as
                  "500 of 500 selected" beside "Import 500 photos" (a flatly false
                  number), then as "500 of about 9,107 loaded so far" — "which
                  makes me think I'm only importing 500". Both times the failure
                  was the same: a SCROLL POSITION sitting where a SCOPE belongs.
                  The real total is counted server-side across every manifest page;
                  until it arrives we say "everything", never a partial count. */}
              <div className="text-[14px] text-stone-600">
                <span className="text-stone-900 font-medium">
                  {manifestTotal !== null
                    ? `${(manifestTotal - deselected.size).toLocaleString()} of ${manifestTotal.toLocaleString()} photos`
                    : "Every photo in this event"}
                </span>{" "}
                will be imported
                {deselected.size > 0 && (
                  <span className="text-stone-400">
                    {" "}
                    · {deselected.size.toLocaleString()} unchecked
                  </span>
                )}
                {manifestTotal === null && countPending && (
                  <span className="text-stone-400"> · counting…</span>
                )}
                {/* A face save changes the SELECTION (the tile unchecks), so
                    its confirmation lives beside the count that just moved —
                    an unexplained decrement here is exactly the class of lie
                    the denominator rules exist to prevent. */}
                {tagNote && (
                  <span className="block text-[12px] text-accent-hover">{tagNote}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {deselected.size > 0 && (
                  <button
                    onClick={() => setDeselected(new Set())}
                    className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                  >
                    Reselect all
                  </button>
                )}
                <BrandButton
                  onClick={startImport}
                  color="emerald"
                  disabled={
                    isStarting ||
                    // Nothing to import: either the counted total is fully
                    // unchecked, or no page has loaded yet at all.
                    (importCount !== null ? importCount === 0 : images.length === 0)
                  }
                >
                  {isStarting
                    ? "Starting…"
                    : importCount !== null
                      ? `Import ${importCount.toLocaleString()} photo${importCount === 1 ? "" : "s"}`
                      : // Counting still in flight. Never a partial number here.
                        deselected.size > 0
                        ? `Import all but ${deselected.size}`
                        : "Import every photo"}
                </BrandButton>
              </div>
            </div>

            {/**
             * Which job was this? — the same question the create screen asks,
             * asked here because an import mints an event too.
             *
             * Above the grid on purpose. It is one short decision and the grid
             * below it is thousands of tiles long; put it under them and it is
             * a thing nobody scrolls to. Pre-seeded with the SPS event's own
             * name, which is usually the client, so the answer is normally one
             * click.
             *
             * Remounted per SPS event (`key`) — the seed query is applied once
             * by design, so a change of subject has to be a change of instance.
             */}
            <div className="mb-8 max-w-2xl empty:mb-0">
              <GigIntelStep
                key={chosen.id}
                seedQuery={chosen.name}
                seedDate={spsShootDate}
                onChange={setGigIntel}
                title="Which job was this?"
                hint="Attaching the calendar entry brings the venue, the crew and the client across with the photos. Optional — the import runs either way."
              />
            </div>

            {/* SPS sends a 200px preview per photo. When it doesn't (rows that
                predate variant generation), each tile costs a full camera file —
                say so, because an unexplained crawl is how the review step gets
                abandoned, and skipping review is what puts setup frames in the
                archive. */}
            {images.some((i) => i.previewIsFullSize) && (
              <p className="mb-6 text-[13px] text-stone-500 flex items-start gap-2 max-w-2xl leading-[1.7]">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-stone-400" />
                <span>
                  Some of these have no small preview on SPS, so those tiles are
                  loading the full-size photo. Scrolling will be slow — the
                  import itself isn&apos;t affected.
                </span>
              </p>
            )}

            {/* CORRECTED 2026-08-11. This used to say these photos "have no
                camera file left on SPS" and would "import as SPS's re-encoded
                copy". That asserted more than is known and turned out to be
                wrong: a sha256 round-trip on the first real import came back
                byte-identical for all six sampled frames. SPS stores JPEG
                uploads verbatim (since 2026-05-05) but only began RECORDING
                that provenance on 2026-08-11 — so for everything shot before
                today the honest statement is "unverified", not "degraded". */}
            {lossyCount > 0 && (
              <p className="mb-6 text-[13px] text-stone-500 flex items-start gap-2 max-w-2xl leading-[1.7]">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-stone-400" />
                <span>
                  SPS can&apos;t vouch for{" "}
                  {stillLoading ? "these" : `${lossyCount.toLocaleString()} of these`}{" "}
                  as camera originals — it only started recording that on 11 Aug.
                  They copy across byte-for-byte exactly as SPS holds them, and
                  for anything shot since May that is almost certainly your
                  original file. They&apos;re marked simply because it
                  isn&apos;t guaranteed the way a labelled one is.
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {images.map((img) => {
                const off = deselected.has(img.id);
                return (
                  /**
                   * A DIV wrapping a button, not a button — the crew tag is a
                   * button of its own, and a button inside a button is invalid
                   * HTML that browsers un-nest unpredictably. The toggle keeps
                   * its full-tile hit area; the tag floats above it.
                   */
                  <div
                    key={img.id}
                    className={cn(
                      "relative aspect-square overflow-hidden bg-stone-100 group transition-all duration-200",
                      off ? "opacity-30" : "opacity-100"
                    )}
                  >
                    <button
                      onClick={() => toggle(img.id)}
                      title={img.originalFilename}
                      className="absolute inset-0 h-full w-full cursor-pointer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.previewUrl}
                        alt={img.originalFilename}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />

                      {/* Checkbox — the affordance has to be visible without
                          hovering, because on a phone there is no hover. */}
                      <span
                        className={cn(
                          "absolute top-2 left-2 w-5 h-5 flex items-center justify-center border transition-colors",
                          off
                            ? "bg-white/70 border-stone-300"
                            : "bg-stone-900 border-stone-900"
                        )}
                      >
                        {!off && <Check size={12} className="text-white" />}
                      </span>

                      {/* "unverified", not "re-encoded" — see the note above the
                          banner. The badge must not claim the file is degraded
                          when the bytes have been shown to be identical. */}
                      {img.quality === "lossy" && (
                        <span className="absolute bottom-2 left-2 label-caps text-[9px] bg-stone-900/70 text-white px-1.5 py-0.5">
                          unverified
                        </span>
                      )}
                    </button>

                    {/**
                     * "That's crew" — keep the face, still skip the frame.
                     * Mason's call on the setup-frame tension: the review grid
                     * is the only moment these frames are on screen before
                     * being discarded. Tagging UNCHECKS the tile, because
                     * keeping the face is the reason the frame can go.
                     * Renders nothing without Event Intel.
                     */}
                    <CrewFaceTag
                      imageUrl={img.fullUrl}
                      onTagged={(name) => {
                        setDeselected((prev) => new Set(prev).add(img.id));
                        setTagNote(`Saved ${name}'s face — the frame stays out of the import.`);
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Paging sentinel */}
            {nextOffset !== null && (
              <div ref={sentinelRef} className="py-10 text-center">
                <p className="text-[13px] text-stone-400 inline-flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" />
                  Loading more…
                </p>
              </div>
            )}
          </>
        )}

        {/* ─── Running ─── */}
        {stage === "running" && (
          <>
            {!job ? (
              <p className="py-24 text-center text-[13px] text-stone-400">
                Starting…
              </p>
            ) : (
              <div className="max-w-2xl">
                {/* The count comes from `landed` — the actual number of rows in
                    the event — not from the job's counter. Counters are the
                    importer's bookkeeping and can drift on a retry; the rows are
                    what is really there. */}
                <div className="mb-8">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="font-editorial text-[32px] text-stone-900">
                      {job.landed.toLocaleString()}
                      {job.expected_total ? (
                        <span className="text-stone-300 text-[20px]">
                          {" "}
                          / {job.expected_total.toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                    <span className="label-caps text-stone-400">
                      {formatBytes(job.bytes_copied)} copied
                    </span>
                  </div>

                  <div className="h-[3px] bg-stone-100 overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-700"
                      style={{
                        width: job.expected_total
                          ? `${Math.min(100, (job.landed / job.expected_total) * 100)}%`
                          : job.status === "completed"
                            ? "100%"
                            : "12%",
                      }}
                    />
                  </div>

                  {pollStale && (
                    <p className="mt-3 text-[12px] text-stone-400">
                      Lost touch with the server for a moment — this number may
                      be behind. Still retrying.
                    </p>
                  )}
                </div>

                {/* An import is minutes of nothing to look at. The elephant is
                    the house loader and belongs on exactly this kind of wait —
                    and here it carries the actual photographs past, which is a
                    better answer to "is anything happening" than a number.
                    The previews are the SPS thumbnails the review grid already
                    loaded (~5KB each), so this costs nothing extra. */}
                {(job.status === "running" || job.status === "queued") && (
                  <div className="mb-8">
                    <ElephantWalk
                      passing={passingPhotos}
                      message={`Copying from SimplePhotoShare`}
                      detail={
                        job.landed === 0
                          ? "Fetching the first page of the manifest…"
                          : `${job.landed.toLocaleString()} across so far`
                      }
                    />
                  </div>
                )}

                <dl className="space-y-3 mb-8 text-[14px]">
                  <div className="flex items-baseline gap-3">
                    <dt className="label-caps text-stone-300 w-32 shrink-0">
                      Status
                    </dt>
                    <dd className="text-stone-700 capitalize">{job.status}</dd>
                  </div>
                  {/* Two different numbers, and conflating them made a perfect
                      import read as a failed one: `reported` is how many we have
                      told SPS are safely here, `confirmed` is how many SPS
                      actually had a separate copy to release. A passthrough
                      image reports nothing to release — so "Confirmed 0" on an
                      all-passthrough event is correct and used to look alarming. */}
                  <div className="flex items-baseline gap-3">
                    <dt className="label-caps text-stone-300 w-32 shrink-0">
                      Reported
                    </dt>
                    <dd className="text-stone-700">
                      {job.reported.toLocaleString()}
                      <span className="text-stone-400">
                        {job.confirmed > 0
                          ? ` — SPS released ${job.confirmed.toLocaleString()} held copies`
                          : " — SPS held no extra copies to release, which is normal"}
                      </span>
                    </dd>
                  </div>
                  {job.images_skipped > 0 && (
                    <div className="flex items-baseline gap-3">
                      <dt className="label-caps text-stone-300 w-32 shrink-0">
                        Already here
                      </dt>
                      <dd className="text-stone-700">{job.images_skipped}</dd>
                    </div>
                  )}
                  {job.images_failed > 0 && (
                    <div className="flex items-baseline gap-3">
                      <dt className="label-caps text-stone-300 w-32 shrink-0">
                        Failed
                      </dt>
                      <dd className="text-red-600">{job.images_failed}</dd>
                    </div>
                  )}
                </dl>

                {job.failures?.length > 0 && (
                  <div className="border border-stone-200 p-4 mb-8">
                    <p className="label-caps mb-3">Failures</p>
                    <ul className="space-y-1.5">
                      {job.failures.slice(0, 10).map((f, i) => (
                        <li key={i} className="text-[13px] text-stone-500">
                          <span className="text-stone-700">{f.filename}</span> —{" "}
                          {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <BrandButton
                    onClick={() => router.push(`/events/${job.event_id}`)}
                    color="emerald"
                  >
                    <Camera size={14} />
                    Open the event
                  </BrandButton>
                  {(job.status === "running" || job.status === "queued") && (
                    <button
                      onClick={cancelImport}
                      className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <X size={13} />
                      Stop importing
                    </button>
                  )}
                </div>

                {job.status === "cancelled" && (
                  <p className="mt-6 text-[13px] text-stone-500 leading-[1.7] max-w-lg">
                    Stopped. The {job.images_done.toLocaleString()} photos
                    already copied are in the event and stay there — starting
                    again picks up where this left off.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}

/**
 * Pick which archive event an SPS event already lives in.
 *
 * A dropdown, not a page: the person is looking at the row that is wrong, and
 * the fix is one name away. Sorted as the archive list returns them (newest
 * first), searchable because 40+ events is past scanning.
 */
function ArchiveLinkPicker({
  spsEvent,
  ptEvents,
  onLinked,
  onClose,
}: {
  spsEvent: SpsEventRow;
  ptEvents: { id: string; name: string }[] | null;
  onLinked: (archiveEventId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = (ptEvents ?? []).filter(
    (e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  const pick = async (eventId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sps/pull/events/${spsEvent.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, spsEventName: spsEvent.name }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Couldn't link.");
        return;
      }
      onLinked(eventId);
    } catch {
      setError("Couldn't link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute right-0 top-full z-20 mt-1 w-72 border border-stone-200 bg-white text-left shadow-[0_8px_24px_-12px_rgba(12,10,9,0.28)]">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Which archive event is it?"
        className="w-full border-b border-stone-100 px-3 py-2 text-[13px] text-stone-800 placeholder:text-stone-300 focus:outline-none"
      />
      <div className="max-h-56 overflow-y-auto">
        {ptEvents === null ? (
          <p className="px-3 py-2 text-[12px] text-stone-400">Loading your archive…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-stone-400">No archive event matches.</p>
        ) : (
          visible.map((e) => (
            <button
              key={e.id}
              disabled={busy}
              onClick={() => pick(e.id)}
              className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
            >
              {e.name}
            </button>
          ))
        )}
      </div>
      {error && (
        <p className="border-t border-stone-100 px-3 py-2 text-[12px] text-amber-700">{error}</p>
      )}
    </div>
  );
}
