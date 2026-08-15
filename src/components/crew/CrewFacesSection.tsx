"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CrewAvatar, type CrewAvatarFace } from "./CrewAvatar";

/**
 * The Faces block on a crew member's Intel panel — the whole crew-faces
 * feature's home base.
 *
 * Three parts, in the order they matter to a roster that is 80% faceless:
 *
 *   1. The reference strip: every photo we know their face from. Star one to
 *      make it the avatar (Mason: "pin or star or whatever makes sense");
 *      remove one; remove EVERYTHING with one action, because a freelancer can
 *      ask and the answer has to be easy.
 *   2. Add a photo — the manual seed path ("in some cases, that's how we'll
 *      start"). Upload → Modal finds the face → it joins the set.
 *   3. Find them in the archive: the reference set searched against every
 *      indexed face. Suggestions only — a click on "That's them" is what
 *      writes, and each yes teaches the set (the confirmed cluster's face
 *      becomes a new reference).
 */

interface FaceRef extends CrewAvatarFace {
  id: string;
  isAvatar: boolean;
  source: string;
  /** Where a click goes — the source photo's event and its face cluster. */
  sourceEventId: string | null;
  sourcePersonId: string | null;
}

interface ClusterMatch {
  personId: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  faceCount: number;
  topSimilarity: number;
  confirmed: boolean;
  face: CrewAvatarFace | null;
}

const CHIP =
  "rounded-full border border-stone-200 px-2.5 py-1 text-[12px] text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-800";

export function CrewFacesSection({
  crewId,
  crewName,
  onAvatarChange,
}: {
  crewId: string;
  crewName: string;
  /** Lets the surrounding board refresh the list circle without a reload. */
  onAvatarChange?: () => void;
}) {
  const [faces, setFaces] = useState<FaceRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<ClusterMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew/${crewId}/faces`);
      if (!res.ok) return;
      const j = await res.json();
      setFaces(j.faces ?? []);
    } catch {
      /* the strip just stays in its loading state */
    }
  }, [crewId]);

  useEffect(() => {
    setFaces(null);
    setMatches(null);
    setMessage(null);
    load();
  }, [load]);

  const act = async (
    body: Record<string, unknown>,
    method: "POST" | "PATCH" | "DELETE"
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/crew/${crewId}/faces`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setMessage(j.error ?? "That didn’t work.");
        return;
      }
      setFaces(j.faces ?? []);
      onAvatarChange?.();
    } catch {
      setMessage("That didn’t work.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setMessage("Under 6MB, please — it only needs to show their face.");
      return;
    }
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    await act({ imageBase64: b64 }, "POST");
  };

  const search = async () => {
    setSearching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/crew/${crewId}/matches`);
      const j = await res.json();
      if (!res.ok) {
        setMessage(j.error ?? "The search didn’t answer.");
        return;
      }
      setMatches(j.matches ?? []);
    } catch {
      setMessage("The search didn’t answer.");
    } finally {
      setSearching(false);
    }
  };

  const confirm = async (personId: string, yes: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/crew/${crewId}/matches`, {
        method: yes ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) {
        setMatches(
          (m) => m?.map((x) => (x.personId === personId ? { ...x, confirmed: yes } : x)) ?? null
        );
        // A yes snapshots the cluster's face into the set — show it.
        if (yes) await load();
        onAvatarChange?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {faces === null ? (
        <p className="text-[12px] text-stone-400">Loading faces…</p>
      ) : (
        <>
          {faces.length > 0 ? (
            <ul className="flex flex-wrap gap-3">
              {faces.map((f) => (
                <li key={f.id} className="group relative">
                  {/**
                   * The circle is a DOOR when its photo still lives in a
                   * gallery — Mason: "if they're in a gallery we should be
                   * able to go look at the images." It lands on the event's
                   * People view with this person's face card open (`?face=`).
                   * Uploads and orphaned references have nowhere to go and
                   * stay plain — matchable, not visitable.
                   */}
                  {f.sourceEventId ? (
                    <a
                      href={`/events/${f.sourceEventId}${f.sourcePersonId ? `?face=${f.sourcePersonId}` : ""}`}
                      title="See this face in its gallery"
                      className="block rounded-full transition-shadow hover:ring-2 hover:ring-accent hover:ring-offset-2"
                    >
                      <CrewAvatar face={f} name={crewName} size={56} />
                    </a>
                  ) : (
                    <CrewAvatar face={f} name={crewName} size={56} />
                  )}
                  {/**
                   * The star sits ON the face, always visible when earned,
                   * hover-revealed when offered — but on touch there is no
                   * hover, so the controls also show for the CURRENT avatar
                   * and the strip explains itself in the caption below.
                   */}
                  <button
                    type="button"
                    disabled={busy || f.isAvatar}
                    onClick={() => act({ faceRefId: f.id }, "PATCH")}
                    title={f.isAvatar ? "Their avatar" : "Make this the avatar"}
                    className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] leading-none transition-all ${
                      f.isAvatar
                        ? "border-accent bg-accent text-white"
                        : "border-stone-200 bg-white text-stone-400 opacity-0 hover:border-stone-400 hover:text-stone-700 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act({ faceRefId: f.id }, "DELETE")}
                    title="Remove this reference"
                    className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white text-[11px] leading-none text-stone-400 opacity-0 transition-all hover:border-red-300 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-stone-400">
              No photos of {crewName.split(" ")[0]} yet — add one and the archive becomes
              searchable for their face.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className={CHIP}
            >
              {busy ? "Working…" : "+ Add a photo"}
            </button>
            {faces.length > 0 && (
              <>
                <button type="button" disabled={searching} onClick={search} className={CHIP}>
                  {searching ? "Searching…" : "Find them in the archive"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove every reference photo and gallery link for ${crewName}? The roster entry stays.`
                      )
                    ) {
                      act({ all: true }, "DELETE");
                      setMatches(null);
                    }
                  }}
                  className="text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-red-700 hover:underline"
                >
                  Remove all
                </button>
              </>
            )}
          </div>

          {message && <p className="mt-2 text-[12px] text-amber-700">{message}</p>}

          {matches !== null && (
            <div className="mt-4">
              {matches.length === 0 ? (
                <p className="text-[13px] text-stone-400">
                  Nothing in the archive looks like them yet. More references make this
                  sharper.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-[12px] text-stone-400">
                    Face groups that look like {crewName.split(" ")[0]} — confirm the real
                    ones. Every yes improves the next search.
                  </p>
                  <ul className="divide-y divide-stone-100">
                    {matches.map((m) => (
                      <li key={m.personId} className="flex items-center gap-3 py-2">
                        <CrewAvatar face={m.face} name={crewName} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-stone-800">
                            {m.eventName}
                          </span>
                          <span className="block text-[12px] text-stone-400">
                            {m.faceCount} photo{m.faceCount === 1 ? "" : "s"} ·{" "}
                            {Math.round(m.topSimilarity * 100)}% match
                          </span>
                        </span>
                        {m.confirmed ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => confirm(m.personId, false)}
                            title="Undo — not them after all"
                            className="rounded-full border border-accent bg-accent px-2.5 py-1 text-[12px] text-white"
                          >
                            ✓ Them
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => confirm(m.personId, true)}
                            className={CHIP}
                          >
                            That’s them
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
