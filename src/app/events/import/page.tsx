"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Camera,
  Loader2,
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

  // Progress state
  const [job, setJob] = useState<PullJob | null>(null);

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
    loadPage(ev.id, 0);
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

  const selectedCount = images.length - deselected.size;
  const lossyCount = images.filter(
    (i) => i.quality === "lossy" && !deselected.has(i.id)
  ).length;

  const startImport = async () => {
    if (!chosen) return;
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
          expectedTotal: nextOffset === null ? selectedCount : null,
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
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/sps/pull/jobs/${jobId}`);
      if (res.ok) {
        const { job: fresh } = (await res.json()) as { job: PullJob };
        setJob(fresh);
        if (fresh.status === "queued" || fresh.status === "running") {
          pollTimer.current = setTimeout(() => pollJob(jobId), 3000);
        }
      }
    } catch {
      pollTimer.current = setTimeout(() => pollJob(jobId), 8000);
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
        <Link
          href="/"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Archive
        </Link>
        <Link href="/events/import" className="editorial-link font-medium text-stone-900">
          Import
        </Link>
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

          <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
            {stage === "pick" && "Import from SimplePhotoShare"}
            {stage === "review" && chosen?.name}
            {stage === "running" && "Pulling camera files"}
          </h1>
          <p className="caption-italic mt-3">
            {stage === "pick" &&
              "Finished events, with their original camera files still on SPS."}
            {stage === "review" &&
              "Everything is selected. Uncheck the setup frames and test shots you don't want archived."}
            {stage === "running" &&
              "Files are copied one page at a time. You can leave this screen."}
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
              <ul className="divide-y divide-stone-100 border-t border-b border-stone-100">
                {events.map((ev) => {
                  const busy =
                    ev.job?.status === "running" || ev.job?.status === "queued";
                  const resumable =
                    ev.job?.status === "cancelled" || ev.job?.status === "failed";
                  return (
                    <li
                      key={ev.id}
                      className="py-5 flex items-center justify-between gap-6"
                    >
                      <div className="min-w-0">
                        <h3 className="text-[16px] text-stone-900 truncate">
                          {ev.name}
                        </h3>
                        <p className="text-[13px] text-stone-400 mt-1">
                          Completed {formatDate(ev.completedAt)}
                          {ev.imageCount ? ` · about ${ev.imageCount} photos` : ""}
                        </p>
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
                        <Link
                          href={`/events/${ev.archiveEventId}`}
                          className="label-caps text-stone-300 hover:text-stone-500 shrink-0 inline-flex items-center gap-1.5"
                        >
                          <Check size={12} />
                          In the archive
                        </Link>
                      ) : (
                        <button
                          onClick={() => beginReview(ev)}
                          className="label-caps text-stone-500 hover:text-stone-900 border border-stone-200 hover:border-stone-400 px-4 py-2 shrink-0 transition-colors cursor-pointer"
                        >
                          Review &amp; import
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* ─── Review ─── */}
        {stage === "review" && chosen && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-6 border-b border-stone-100">
              <div className="text-[14px] text-stone-600">
                <span className="text-stone-900 font-medium">
                  {selectedCount}
                </span>{" "}
                of {images.length} selected
                {nextOffset !== null && (
                  <span className="text-stone-400"> · still loading</span>
                )}
                {lossyCount > 0 && (
                  <span className="text-stone-400">
                    {" "}
                    · {lossyCount} not archive-grade
                  </span>
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
                  disabled={isStarting || selectedCount === 0}
                >
                  {isStarting
                    ? "Starting…"
                    : `Import ${selectedCount} photo${selectedCount === 1 ? "" : "s"}`}
                </BrandButton>
              </div>
            </div>

            {lossyCount > 0 && (
              <p className="mb-6 text-[13px] text-stone-500 flex items-start gap-2 max-w-2xl leading-[1.7]">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
                <span>
                  {lossyCount} of these have no camera file left on SPS — they
                  were shot before the connection existed, or their 30-day hold
                  expired. They&apos;ll import as SPS&apos;s re-encoded copy,
                  and they&apos;re marked so you can tell later.
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {images.map((img) => {
                const off = deselected.has(img.id);
                return (
                  <button
                    key={img.id}
                    onClick={() => toggle(img.id)}
                    title={img.originalFilename}
                    className={cn(
                      "relative aspect-square overflow-hidden bg-stone-100 group cursor-pointer transition-all duration-200",
                      off ? "opacity-30" : "opacity-100"
                    )}
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

                    {img.quality === "lossy" && (
                      <span className="absolute bottom-2 left-2 label-caps text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5">
                        re-encoded
                      </span>
                    )}
                  </button>
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
                <div className="mb-8">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="font-editorial text-[32px] text-stone-900">
                      {job.images_done.toLocaleString()}
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
                          ? `${Math.min(100, (job.images_done / job.expected_total) * 100)}%`
                          : job.status === "completed"
                            ? "100%"
                            : "12%",
                      }}
                    />
                  </div>
                </div>

                <dl className="space-y-3 mb-8 text-[14px]">
                  <div className="flex items-baseline gap-3">
                    <dt className="label-caps text-stone-300 w-32 shrink-0">
                      Status
                    </dt>
                    <dd className="text-stone-700 capitalize">{job.status}</dd>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <dt className="label-caps text-stone-300 w-32 shrink-0">
                      Confirmed
                    </dt>
                    <dd className="text-stone-700">
                      {job.confirmed.toLocaleString()}
                      <span className="text-stone-400">
                        {" "}
                        — SPS may release these
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
