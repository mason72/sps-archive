"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, EyeOff, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  JOB_BALLPARKS,
  JOB_BALLPARK_LABELS,
  JOB_DURATIONS,
  JOB_DURATION_LABELS,
  JOB_EVENT_SIZES,
  JOB_EVENT_SIZE_LABELS,
  JOB_INDUSTRIES,
  JOB_INDUSTRY_LABELS,
  JOB_SERVICES,
  JOB_SERVICE_LABELS,
  JOB_TEAMS,
  JOB_TEAMS_LABELS,
  isValidJobSlug,
  jobMissingFields,
  jobSlugFromKey,
  parseJobMeta,
  suggestAlias,
  suggestIndustryForClient,
  type JobMeta,
} from "@/lib/site/jobs";

interface JobDetailsModalProps {
  sectionId: string;
  sectionName: string;
  /** The section's site_scene_key ("job/<slug>") — source of the URL slug. */
  siteSceneKey: string;
  /** The stored job_meta document (raw jsonb), or null for a fresh job. */
  initialMeta: unknown;
  /** Photos currently in the job (drives the live/not-live hint). */
  imageCount: number;
  /** Prefills for empty fields, derived from the job's images (editable). */
  prefill?: { city?: string | null; year?: number | null };
  onClose: () => void;
  /** Fired after a successful save with the stored meta + (possibly new) key. */
  onSaved: (sectionId: string, meta: JobMeta, siteSceneKey: string) => void;
}

/**
 * JobDetailsModal — the one form behind a TDP Work job's infosheet. Every
 * job-sheet field the website renders lives here; enum labels mirror the
 * site's copy exactly, so what the team picks is what visitors read.
 *
 * Partial saves are fine (a job stays an editor-only draft until its
 * required fields are complete and it has a published photo); the footer
 * checklist says exactly what's still missing.
 */
export function JobDetailsModal({
  sectionId,
  sectionName,
  siteSceneKey,
  initialMeta,
  imageCount,
  prefill,
  onClose,
  onSaved,
}: JobDetailsModalProps) {
  const initial = useMemo(() => parseJobMeta(initialMeta), [initialMeta]);
  const [meta, setMeta] = useState<JobMeta>(() => ({
    ...initial,
    // Smart prefills fill EMPTY fields only — saved values always win.
    city: initial.city ?? prefill?.city ?? null,
    year: initial.year ?? prefill?.year ?? null,
  }));
  const initialSlug = jobSlugFromKey(siteSceneKey);
  const [slug, setSlug] = useState(initialSlug);
  const [isSaving, setIsSaving] = useState(false);
  // Once the team touches industry (or it arrived saved), stop auto-suggesting.
  const industryTouched = useRef(initial.industry !== null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const set = <K extends keyof JobMeta>(key: K, value: JobMeta[K]) =>
    setMeta((prev) => ({ ...prev, [key]: value }));

  // Known-brand magic: typing "Google" suggests the industry (and, for
  // brands outside the site's enum, the free-text industry too).
  const handleClientBlur = () => {
    if (!meta.client || industryTouched.current) return;
    const suggestion = suggestIndustryForClient(meta.client);
    if (suggestion) {
      setMeta((prev) => ({
        ...prev,
        industry: suggestion.industry,
        industryOther: suggestion.industryOther,
      }));
    }
  };

  const handleAnonymizeToggle = () => {
    setMeta((prev) => ({
      ...prev,
      anonymize: !prev.anonymize,
      // Turning it on with no alias yet → suggest one (curated for known
      // brands, composed from size + industry otherwise). Always editable.
      alias: !prev.anonymize && !prev.alias ? suggestAlias(prev) : prev.alias,
    }));
  };

  const toggleService = (service: string) => {
    setMeta((prev) => ({
      ...prev,
      services: prev.services.includes(service)
        ? prev.services.filter((s) => s !== service)
        : [...prev.services, service],
    }));
  };

  const missing = jobMissingFields(meta);
  const slugChanged = slug !== initialSlug;
  const slugValid = isValidJobSlug(slug);
  const isLive = missing.length === 0 && imageCount > 0;

  const handleSave = async () => {
    if (slugChanged && !slugValid) {
      toast.error("Slug must be lowercase words separated by hyphens");
      return;
    }
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = { jobMeta: meta };
      if (slugChanged) body.jobSlug = slug;
      const res = await fetch(`/api/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to save job details");
      }
      const data = (await res.json()) as {
        section: { siteSceneKey: string; jobMeta: unknown };
      };
      toast.success(
        missing.length === 0
          ? "Job details saved"
          : `Saved — not live yet (missing: ${missing.join(", ")})`
      );
      onSaved(sectionId, parseJobMeta(data.section.jobMeta), data.section.siteSceneKey);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save job details");
    } finally {
      setIsSaving(false);
    }
  };

  if (typeof window === "undefined") return null;

  const inputClass =
    "w-full bg-transparent border-b border-stone-200 pb-1.5 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors";
  const selectClass = `${inputClass} cursor-pointer appearance-none`;
  const labelClass =
    "text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium";

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2013 }, (_, i) => currentYear - i);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-xl max-h-[90vh] flex flex-col bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="min-w-0">
            <p className={labelClass}>Job details</p>
            <p className="text-[13px] text-stone-600 truncate">
              {sectionName} — the infosheet on the website
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-medium ${
                isLive ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLive ? "bg-emerald-500" : "bg-amber-400"
                }`}
              />
              {isLive ? "Live" : "Not live"}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Client + anonymize */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className={labelClass}>Client</label>
              <input
                type="text"
                value={meta.client ?? ""}
                onChange={(e) => set("client", e.target.value || null)}
                onBlur={handleClientBlur}
                placeholder="e.g. ServiceNow"
                className={`${inputClass} ${meta.anonymize ? "text-stone-400 line-through decoration-stone-300" : ""}`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Event name</label>
              <input
                type="text"
                value={meta.eventName ?? ""}
                onChange={(e) => set("eventName", e.target.value || null)}
                placeholder="e.g. Knowledge 25 (optional)"
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleAnonymizeToggle}
            className="w-full flex items-center justify-between group"
          >
            <span className="text-left">
              <span className="block text-[14px] text-stone-900">Anonymize client</span>
              <span className="block text-[11px] text-stone-400">
                The site shows the alias — the client name is never sent to it
              </span>
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center border transition-colors ${
                meta.anonymize
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-stone-200 text-stone-300 group-hover:border-stone-400"
              }`}
            >
              <EyeOff className="h-3.5 w-3.5" />
            </span>
          </button>

          {meta.anonymize && (
            <div className="space-y-1.5">
              <label className={labelClass}>Public alias (required)</label>
              <input
                type="text"
                value={meta.alias ?? ""}
                onChange={(e) => set("alias", e.target.value || null)}
                placeholder='e.g. "Fortune 100 tech company"'
                className={inputClass}
              />
            </div>
          )}

          {/* Where */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className={labelClass}>City</label>
              <input
                type="text"
                value={meta.city ?? ""}
                onChange={(e) => set("city", e.target.value || null)}
                placeholder="e.g. Las Vegas"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Venue</label>
              <input
                type="text"
                value={meta.venue ?? ""}
                onChange={(e) => set("venue", e.target.value || null)}
                placeholder="e.g. MGM Grand (optional)"
                className={inputClass}
              />
            </div>
          </div>

          {/* Services */}
          <div className="space-y-2">
            <label className={labelClass}>Services on this job</label>
            <div className="flex flex-wrap gap-1.5">
              {JOB_SERVICES.map((service) => {
                const on = meta.services.includes(service);
                return (
                  <button
                    key={service}
                    type="button"
                    onClick={() => toggleService(service)}
                    className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] transition-colors ${
                      on
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 text-stone-500 hover:border-stone-400"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {JOB_SERVICE_LABELS[service]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The numbers */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className={labelClass}>Event size</label>
              <select
                value={meta.eventSize ?? ""}
                onChange={(e) =>
                  set("eventSize", (e.target.value || null) as JobMeta["eventSize"])
                }
                className={selectClass}
              >
                <option value="">Select…</option>
                {JOB_EVENT_SIZES.map((v) => (
                  <option key={v} value={v}>{JOB_EVENT_SIZE_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Duration</label>
              <select
                value={meta.duration ?? ""}
                onChange={(e) =>
                  set("duration", (e.target.value || null) as JobMeta["duration"])
                }
                className={selectClass}
              >
                <option value="">Select…</option>
                {JOB_DURATIONS.map((v) => (
                  <option key={v} value={v}>{JOB_DURATION_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Teams on the floor</label>
              <select
                value={meta.teams ?? ""}
                onChange={(e) =>
                  set("teams", (e.target.value || null) as JobMeta["teams"])
                }
                className={selectClass}
              >
                <option value="">Select…</option>
                {JOB_TEAMS.map((v) => (
                  <option key={v} value={v}>{JOB_TEAMS_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Ballpark</label>
              <select
                value={meta.ballpark ?? ""}
                onChange={(e) =>
                  set("ballpark", (e.target.value || null) as JobMeta["ballpark"])
                }
                className={selectClass}
              >
                <option value="">Hidden on the site</option>
                {JOB_BALLPARKS.map((v) => (
                  <option key={v} value={v}>{JOB_BALLPARK_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Industry</label>
              <select
                value={meta.industry ?? ""}
                onChange={(e) => {
                  industryTouched.current = true;
                  const industry = (e.target.value || null) as JobMeta["industry"];
                  setMeta((prev) => ({
                    ...prev,
                    industry,
                    industryOther: industry === "other" ? prev.industryOther : null,
                  }));
                }}
                className={selectClass}
              >
                <option value="">Select…</option>
                {JOB_INDUSTRIES.map((v) => (
                  <option key={v} value={v}>{JOB_INDUSTRY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Year</label>
              <select
                value={meta.year ?? ""}
                onChange={(e) =>
                  set("year", e.target.value ? Number(e.target.value) : null)
                }
                className={selectClass}
              >
                <option value="">Not shown</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {meta.industry === "other" && (
            <div className="space-y-1.5">
              <label className={labelClass}>Industry, in your words (required)</label>
              <input
                type="text"
                value={meta.industryOther ?? ""}
                onChange={(e) => set("industryOther", e.target.value || null)}
                placeholder='e.g. "Food & beverage"'
                className={inputClass}
              />
            </div>
          )}

          {/* Touchups — simple on/off; the job sheet shows a TOUCHUPS row */}
          <button
            type="button"
            onClick={() => set("touchups", !meta.touchups)}
            className="w-full flex items-center justify-between group"
          >
            <span className="text-left">
              <span className="block text-[14px] text-stone-900">
                Hair + makeup touchups on site
              </span>
              <span className="block text-[11px] text-stone-400">
                Adds a &ldquo;Touchups — artists on site&rdquo; row to the job sheet
              </span>
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center border transition-colors ${
                meta.touchups
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-stone-200 text-stone-300 group-hover:border-stone-400"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          </button>

          {/* Slug — frozen at creation; editing it moves the job's site URL */}
          <div className="space-y-1.5">
            <label className={labelClass}>URL slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              spellCheck={false}
              className={`${inputClass} font-mono text-[13px] ${
                slugChanged && !slugValid ? "border-red-300" : ""
              }`}
            />
            <p className="text-[11px] text-stone-400 leading-relaxed">
              Stays put when the job is renamed. Change it only on purpose —
              the site links jobs by slug.
            </p>
          </div>
        </div>

        {/* Footer — completeness + save */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-stone-100">
          <p className="text-[11px] leading-relaxed min-w-0">
            {missing.length > 0 ? (
              <span className="text-amber-600">
                Not on the site yet — missing {missing.join(", ")}
              </span>
            ) : imageCount === 0 ? (
              <span className="text-amber-600">
                Details complete — add photos to put it live
              </span>
            ) : (
              <span className="text-emerald-600">
                Complete — live on the site
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
