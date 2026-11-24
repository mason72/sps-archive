"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Plus, Search, Star, Users, X } from "lucide-react";
import {
  STORY_LIMITS,
  WORK_EVENT_SLUG,
  storyNamesClient,
  type JobMeta,
  type JobSource,
  type JobStoryMeta,
} from "@/lib/site/jobs";

/**
 * The case-study half of the job form (twodudesphoto.com/work/<slug>):
 * the Special mark, the client galleries the job delivered (proof is counted
 * from them on save), and the written story with its draft/publish switch.
 *
 * Stories arrive as drafts from Claude or Scout and go live only when Mason
 * approves them here; the site never receives a draft.
 */

interface GalleryRow {
  id: string;
  name: string;
  date: string | null;
  photos: number | null;
}

interface EventsResponse {
  events?: Array<{
    id: string;
    name: string;
    slug?: string | null;
    event_date?: string | null;
    images?: Array<{ count: number }> | null;
  }>;
}

// "tdp-website" is WEBSITE_EVENT_SLUG (src/lib/site/gallery.ts), written out
// because that module imports server-only code and this file ships to the
// browser. The server refuses both galleries as sources regardless.
const HIDDEN_SLUGS = new Set([WORK_EVENT_SLUG, "tdp-website"]);

function toRows(data: EventsResponse): GalleryRow[] {
  return (data.events ?? [])
    .filter((e) => !HIDDEN_SLUGS.has(e.slug ?? ""))
    .map((e) => ({
      id: e.id,
      name: e.name,
      date: e.event_date ?? null,
      photos: e.images?.[0]?.count ?? null,
    }));
}

function shortDate(iso: string | null) {
  if (!iso) return "No date";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const n = (v: number) => v.toLocaleString("en-US");

const SOURCE_LABEL: Record<JobStoryMeta["source"], string> = {
  mason: "Mason",
  claude: "Claude",
  scout: "Scout",
};

interface Props {
  meta: JobMeta;
  setMeta: React.Dispatch<React.SetStateAction<JobMeta>>;
  /** The sources as last saved, to tell "counted" from "recount on save". */
  savedSources: JobSource[];
  /** Publish the draft and save in one tap. */
  onApprove: () => void;
  isSaving: boolean;
  inputClass: string;
  labelClass: string;
}

export function JobStoryPanel({
  meta,
  setMeta,
  savedSources,
  onApprove,
  isSaving,
  inputClass,
  labelClass,
}: Props) {
  const [names, setNames] = useState<Map<string, GalleryRow>>(new Map());
  // Default search: the client, so the likely galleries are one glance away.
  const [query, setQuery] = useState(meta.sources.length === 0 ? meta.client ?? "" : "");
  const [results, setResults] = useState<GalleryRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const reqId = useRef(0);
  // Ids already asked for, so each linked gallery is looked up once, not on
  // every render. Deliberately NOT cancelled on re-render: an answer for an
  // id is still the answer after a re-render, and cancelling it left the
  // guard believing the name had been fetched. A failed lookup is shown per
  // row and asked again only when the form is reopened.
  const asked = useRef(new Set<string>());
  const [notFound, setNotFound] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // Names for galleries already linked (ids are all job_meta stores).
  useEffect(() => {
    const missing = meta.sources.map((s) => s.eventId).filter((id) => !names.has(id) && !asked.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) asked.current.add(id);
    fetch(`/api/events?ids=${missing.join(",")}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: EventsResponse) => {
        const rows = toRows(data);
        const found = new Set(rows.map((r) => r.id));
        setNames((prev) => {
          const next = new Map(prev);
          for (const row of rows) next.set(row.id, row);
          return next;
        });
        setNotFound((prev) => new Set([...prev, ...missing.filter((id) => !found.has(id))]));
      })
      .catch(() => setFailed((prev) => new Set([...prev, ...missing])));
  }, [meta.sources, names]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      ++reqId.current; // an answer still in flight is for a query that is gone
      setResults([]);
      setSearchError(false);
      setSearching(false);
      return;
    }
    const id = ++reqId.current;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/events?q=${encodeURIComponent(q)}&limit=12&sort=date-desc`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: EventsResponse) => {
          if (id !== reqId.current) return;
          setResults(toRows(data));
          setSearchError(false);
        })
        .catch(() => id === reqId.current && setSearchError(true))
        .finally(() => id === reqId.current && setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const linked = new Set(meta.sources.map((s) => s.eventId));
  const sourcesChanged = useMemo(
    () => JSON.stringify(meta.sources) !== JSON.stringify(savedSources),
    [meta.sources, savedSources]
  );

  const addSource = (row: GalleryRow) => {
    setNames((prev) => new Map(prev).set(row.id, row));
    setMeta((prev) =>
      prev.sources.some((s) => s.eventId === row.id)
        ? prev
        : // Headshot galleries are the ones whose faces are worth counting.
          { ...prev, sources: [...prev.sources, { eventId: row.id, people: /headshot/i.test(row.name) }] }
    );
  };
  const removeSource = (id: string) =>
    setMeta((prev) => ({ ...prev, sources: prev.sources.filter((s) => s.eventId !== id) }));
  const togglePeople = (id: string) =>
    setMeta((prev) => ({
      ...prev,
      sources: prev.sources.map((s) => (s.eventId === id ? { ...s, people: !s.people } : s)),
    }));

  const story = meta.story;
  const setStory = (patch: Partial<JobStoryMeta>) =>
    setMeta((prev) => (prev.story ? { ...prev, story: { ...prev.story, ...patch } } : prev));
  const startStory = () =>
    setMeta((prev) => ({
      ...prev,
      story: { status: "draft", source: "mason", headline: "", dek: null, body: "", quote: null },
    }));
  const namesClient = storyNamesClient(meta);
  const proof = meta.proof;

  return (
    <div className="space-y-5 border-t border-stone-100 pt-5">
      <p className={labelClass}>Case study · twodudesphoto.com/work</p>

      {/* Special */}
      <button
        type="button"
        onClick={() => setMeta((prev) => ({ ...prev, special: !prev.special }))}
        className="w-full flex items-center justify-between group"
        aria-pressed={meta.special}
      >
        <span className="text-left">
          <span className="block text-[14px] text-stone-900">Special job</span>
          <span className="block text-[11px] text-stone-400">
            Leads the Work page with a full spread. Best with a published story.
          </span>
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center border transition-colors ${
            meta.special
              ? "border-accent bg-accent/10 text-accent"
              : "border-stone-200 text-stone-300 group-hover:border-stone-400"
          }`}
        >
          <Star className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Source galleries */}
      <div className="space-y-2">
        <label className={labelClass}>Client galleries delivered</label>
        {meta.sources.length > 0 && (
          <ul className="divide-y divide-stone-100 border-y border-stone-100">
            {meta.sources.map((s) => {
              const row = names.get(s.eventId);
              return (
                <li key={s.eventId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-stone-900">
                      {row?.name ??
                        (notFound.has(s.eventId)
                          ? "Gallery not found (deleted?)"
                          : failed.has(s.eventId)
                            ? "Couldn't load the name (reopen to retry)"
                            : "Loading…")}
                    </span>
                    <span className="block text-[11px] text-stone-400">
                      {row ? `${shortDate(row.date)}${row.photos != null ? ` · ${n(row.photos)} photos` : ""}` : " "}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePeople(s.eventId)}
                    aria-pressed={s.people}
                    title={s.people ? "Counting people from this gallery" : "Not counting people (event coverage undercounts faces)"}
                    className={`flex items-center gap-1 border px-2 py-1 text-[11px] transition-colors ${
                      s.people
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 text-stone-400 hover:border-stone-400"
                    }`}
                  >
                    <Users className="h-3 w-3" />
                    People
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSource(s.eventId)}
                    className="p-1 text-stone-300 hover:text-stone-900 transition-colors"
                    aria-label={`Remove ${row?.name ?? "gallery"}`}
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-0 top-1 h-3.5 w-3.5 text-stone-300" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add a gallery: search by name or year"
            className={`${inputClass} pl-5`}
          />
        </div>
        {query.trim().length >= 2 && (
          <ul className="max-h-48 overflow-y-auto">
            {results.map((row) => {
              const on = linked.has(row.id);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={on}
                    onClick={() => addSource(row)}
                    className="flex w-full items-center gap-3 py-1.5 text-left text-[12px] text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                  >
                    {on ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 text-[11px] text-stone-400">
                      {shortDate(row.date)}
                      {row.photos != null ? ` · ${n(row.photos)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            {!searching && !searchError && results.length === 0 && (
              <li className="py-1.5 text-[12px] text-stone-400">No galleries match</li>
            )}
            {searchError && (
              <li className="py-1.5 text-[12px] text-amber-600">Search failed. Try again.</li>
            )}
          </ul>
        )}

        <p className="text-[11px] leading-relaxed text-stone-400">
          {sourcesChanged ? (
            <span className="text-amber-600">Counted again when you save.</span>
          ) : proof ? (
            <>
              Counted {shortDate(proof.countedAt.slice(0, 10))}: {n(proof.photos)} photos ·{" "}
              {proof.galleries} {proof.galleries === 1 ? "gallery" : "galleries"}
              {proof.people != null ? ` · ${n(proof.people)} people` : ""}
              {proof.days ? ` · ${proof.days.length} ${proof.days.length === 1 ? "day" : "days"} on the floor` : ""}
            </>
          ) : (
            "The site's proof numbers and day chart are counted from these, never typed."
          )}{" "}
          Turn on People only for headshot galleries: event coverage finds a fraction of the faces.
        </p>
      </div>

      {/* Story */}
      {!story ? (
        <button
          type="button"
          onClick={startStory}
          className="flex items-center gap-2 border border-dashed border-stone-300 px-3 py-2 text-[12px] text-stone-500 hover:border-stone-900 hover:text-stone-900 transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Write a story
        </button>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-medium ${
                story.status === "published" ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  story.status === "published" ? "bg-emerald-500" : "bg-amber-400"
                }`}
              />
              {story.status === "published" ? "Story published" : `Draft by ${SOURCE_LABEL[story.source]}`}
            </span>
            <span className="flex items-center gap-3">
              {story.status === "draft" ? (
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isSaving}
                  className="px-3 py-1 bg-stone-900 text-white text-[11px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40"
                >
                  Approve and publish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStory({ status: "draft" })}
                  className="text-[11px] text-stone-400 hover:text-stone-900 transition-colors"
                >
                  Unpublish
                </button>
              )}
              <button
                type="button"
                onClick={() => setMeta((prev) => ({ ...prev, story: null }))}
                className="text-[11px] text-stone-400 hover:text-red-600 transition-colors"
              >
                Remove
              </button>
            </span>
          </div>

          {namesClient && (
            <p className="text-[12px] leading-relaxed text-red-700">
              This story names the client, and the job is anonymized. The site will not show it
              until the name is gone.
            </p>
          )}

          <div className="space-y-1.5">
            <label className={labelClass}>Headline</label>
            <input
              type="text"
              value={story.headline}
              maxLength={STORY_LIMITS.headline}
              onChange={(e) => setStory({ headline: e.target.value })}
              placeholder="Booked for headshots. Asked back for everything else."
              className={`${inputClass} text-[16px] font-medium`}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Standfirst (one sentence)</label>
            <input
              type="text"
              value={story.dek ?? ""}
              maxLength={STORY_LIMITS.dek}
              onChange={(e) => setStory({ dek: e.target.value || null })}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Story</label>
            <textarea
              value={story.body}
              maxLength={STORY_LIMITS.body}
              onChange={(e) => setStory({ body: e.target.value })}
              rows={9}
              placeholder="Plain text. A blank line starts a new paragraph."
              className="w-full resize-y border border-stone-200 p-2.5 text-[13px] leading-relaxed text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Client quote (real words only)</label>
            <input
              type="text"
              value={story.quote?.text ?? ""}
              maxLength={STORY_LIMITS.quote}
              onChange={(e) => {
                const text = e.target.value;
                setStory({
                  quote: text || story.quote?.by
                    ? { text, by: story.quote?.by ?? "", role: story.quote?.role ?? null }
                    : null,
                });
              }}
              placeholder="Leave empty if there isn't one"
              className={inputClass}
            />
            {story.quote && (
              <div className="grid grid-cols-2 gap-5 pt-2">
                <input
                  type="text"
                  value={story.quote.by}
                  maxLength={STORY_LIMITS.by}
                  onChange={(e) => setStory({ quote: { ...story.quote!, by: e.target.value } })}
                  placeholder="Who said it"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={story.quote.role ?? ""}
                  maxLength={STORY_LIMITS.role}
                  onChange={(e) =>
                    setStory({ quote: { ...story.quote!, role: e.target.value || null } })
                  }
                  placeholder="Role (optional)"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
