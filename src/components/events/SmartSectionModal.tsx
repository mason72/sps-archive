"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SectionLite {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
}

interface Match {
  id: string;
  thumbnailUrl?: string;
  filename?: string;
  /** Matched by filename / parsed name, not by the AI description search. */
  byName?: boolean;
  /** Matched by detected face count ("group" = 2+ faces), not by the AI. */
  byFaces?: boolean;
}

// Phrases, not nouns: the model scores "people posing together" far above the
// bare word "group", whose best match on a headshot day was 0.115 (weak) and
// whose relative cut dropped every two-person frame (2026-08-21).
const EXAMPLES = ["people wearing glasses", "candid laughing", "people posing together", "on stage"];

/**
 * SmartSectionModal — describe a section, get the photos.
 *
 * Additive by design: one new section, nothing else disturbed. "Copy" leaves
 * the photos in their current sections (membership is a reference, never a
 * second file); "Move" pulls them out of the others.
 */
export function SmartSectionModal({
  eventId,
  imageById,
  onCreated,
  onClose,
}: {
  eventId: string;
  /** The editor's already-loaded images (thumb + filename) for previews. */
  imageById: Map<string, { thumbnailUrl: string; filename: string }>;
  onCreated: (sections: SectionLite[], sectionId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showFilenames, setShowFilenames] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fixed overlay: freeze the page behind the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, creating]);

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 3) return;
      setSearching(true);
      setMatches(null);
      try {
        // NAME FIRST, then the AI — the same rule the guest gallery's search
        // box follows. This modal used to be AI-only, so "group" found 14
        // visually-grouped photos here and 36 on the client side, where every
        // "Justin Group_…" filename matched — Justin asked whether the two
        // searches were even the same engine (they are; one had a filename
        // pass, the other did not; 2026-08-21). Union: name hits lead and are
        // marked, AI hits fill in the rest.
        const call = async (type: "filename" | "faces" | "semantic") => {
          const params = new URLSearchParams({ q: trimmed, eventId, type, limit: "400" });
          const res = await fetch(`/api/search?${params}`);
          if (!res.ok) throw new Error();
          const data = (await res.json()) as { results?: Match[] };
          return data.results ?? [];
        };
        // Names, then face counts ("group" = 2+ faces — structural, from the
        // detector), then the AI. See face-count-query.ts for the vocabulary.
        const [byName, byFaces, byAi] = await Promise.all([
          call("filename"),
          call("faces"),
          call("semantic"),
        ]);
        const seen = new Set<string>();
        const union: Match[] = [];
        for (const m of byName) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          union.push({ ...m, byName: true });
        }
        for (const m of byFaces) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          union.push({ ...m, byFaces: true });
        }
        for (const m of byAi) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          union.push(m);
        }
        setMatches(union);
        setSearched(trimmed);
        setExcluded(new Set());
        if (!nameTouched) {
          setName(trimmed.replace(/\b\w/g, (c) => c.toUpperCase()));
        }
      } catch {
        toast.error("Search failed — try again");
        setMatches([]);
      } finally {
        setSearching(false);
      }
    },
    [eventId, nameTouched]
  );

  const kept = useMemo(
    () => (matches ?? []).filter((m) => !excluded.has(m.id)),
    [matches, excluded]
  );

  const create = useCallback(async () => {
    if (!name.trim() || kept.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/events/${eventId}/smart-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          imageIds: kept.map((m) => m.id),
          mode,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed");
      }
      const data = (await res.json()) as {
        sections: SectionLite[];
        sectionId: string;
        added: number;
      };
      onCreated(data.sections, data.sectionId);
      toast.success(`“${name.trim()}” — ${data.added} photo${data.added === 1 ? "" : "s"}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create the section");
    } finally {
      setCreating(false);
    }
  }, [eventId, name, kept, mode, onCreated, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={creating ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-stone-100 px-6 py-5">
          <div>
            <h2 className="font-editorial text-[22px] leading-tight text-stone-900">
              Smart section
            </h2>
            <p className="mt-0.5 text-[12px] text-stone-400">
              Describe what belongs in it — we&apos;ll find the photos.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") search(query);
              }}
              placeholder="e.g. people wearing glasses"
              className="flex-1 border-b border-stone-200 bg-transparent py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
            />
            <button
              onClick={() => search(query)}
              disabled={searching || query.trim().length < 3}
              className="flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Find
            </button>
          </div>

          {!matches && !searching && (
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setQuery(ex);
                    search(ex);
                  }}
                  className="border border-stone-200 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-600"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {searching && (
            <p className="mt-8 flex items-center justify-center gap-2 text-[13px] italic text-stone-400">
              <Loader2 size={14} className="animate-spin" /> Looking through your photos…
            </p>
          )}

          {matches && !searching && (
            <div className="mt-5">
              {matches.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                  Nothing matched “{searched}”. Try describing the photo itself — what
                  you&apos;d see in it.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                      {kept.length} photo{kept.length === 1 ? "" : "s"}
                      {(() => {
                        const n = kept.filter((m) => m.byName).length;
                        const f = kept.filter((m) => m.byFaces).length;
                        const a = kept.length - n - f;
                        const parts = [
                          n > 0 ? `${n} by name` : null,
                          f > 0 ? `${f} by faces in frame` : null,
                          a > 0 ? `${a} by description` : null,
                        ].filter(Boolean);
                        return parts.length > 1 ? ` · ${parts.join(", ")}` : n > 0 ? " · matched by name" : f > 0 ? " · matched by faces in frame" : "";
                      })()}
                      {" "}· click to remove any that don&apos;t belong
                    </p>
                    <button
                      onClick={() => setShowFilenames((v) => !v)}
                      className={cn(
                        "text-[11px] transition-colors",
                        showFilenames
                          ? "text-stone-600"
                          : "text-stone-300 hover:text-stone-500"
                      )}
                    >
                      Filenames
                    </button>
                  </div>
                  <div className="grid max-h-64 grid-cols-5 gap-x-1.5 gap-y-2 overflow-y-auto sm:grid-cols-6">
                    {matches.map((m) => {
                      const entry = imageById.get(m.id);
                      const url = entry?.thumbnailUrl ?? m.thumbnailUrl;
                      const filename = entry?.filename ?? m.filename;
                      const off = excluded.has(m.id);
                      return (
                        <figure key={m.id} className={cn(off && "opacity-25")}>
                          <button
                            onClick={() =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.id)) next.delete(m.id);
                                else next.add(m.id);
                                return next;
                              })
                            }
                            title={filename}
                            className="relative block w-full aspect-square overflow-hidden bg-stone-100 transition-opacity"
                          >
                            {url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={url}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover object-top"
                              />
                            )}
                            {(m.byName || m.byFaces) && (
                              <span
                                className="absolute left-1 top-1 bg-white/85 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-stone-500 backdrop-blur-sm"
                                title={m.byName ? "Matched by filename" : "Matched by the number of faces in the frame"}
                              >
                                {m.byName ? "name" : "faces"}
                              </span>
                            )}
                          </button>
                          {showFilenames && filename && (
                            <figcaption className="mt-0.5 text-[8px] leading-tight text-stone-400 truncate">
                              {filename}
                            </figcaption>
                          )}
                        </figure>
                      );
                    })}
                  </div>

                  <div className="mt-5">
                    <label className="mb-1.5 block text-[12px] font-medium text-stone-700">
                      Section name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameTouched(true);
                      }}
                      className="w-full border-b border-stone-200 bg-transparent py-2 text-[14px] text-stone-900 focus:border-stone-900 focus:outline-none"
                    />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {(
                      [
                        {
                          v: "copy" as const,
                          label: "Copy here",
                          hint: "photos stay in their sections too",
                        },
                        {
                          v: "move" as const,
                          label: "Move here",
                          hint: "removes them from other sections",
                        },
                      ]
                    ).map((o) => (
                      <button
                        key={o.v}
                        onClick={() => setMode(o.v)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          mode === o.v
                            ? "border-emerald-500 bg-emerald-50/60"
                            : "border-stone-200 hover:border-stone-300"
                        )}
                      >
                        <span className="block text-[12px] font-medium text-stone-800">
                          {o.label}
                        </span>
                        <span className="block text-[10px] leading-tight text-stone-400">
                          {o.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-100 px-6 py-4">
          <p className="max-w-[55%] text-[11px] leading-tight text-stone-400">
            Creates one new section. Your other sections are untouched.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={creating}
              className="text-[13px] text-stone-500 hover:text-stone-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating || kept.length === 0 || !name.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating
                ? "Creating…"
                : kept.length > 0
                ? `Create with ${kept.length} photo${kept.length === 1 ? "" : "s"}`
                : "Create section"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
