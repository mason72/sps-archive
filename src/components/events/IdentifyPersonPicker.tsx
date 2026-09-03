"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FaceCircleCrop } from "@/components/faces/FaceCircleCrop";

/**
 * "Who is this?" — the bridge from a photo you are looking at to the cluster
 * panel where identity is actually decided.
 *
 * Mason (2026-09-02), looking at a stack of frames whose filenames had lost
 * their names: "How do I tag a person in a photo? She's grouped under SHRM
 * with other people." Everything needed already existed — rename, crew…, and
 * split all live on PeopleView's person panel — but nothing on the grid
 * pointed at it, so the machinery was unreachable from the place the question
 * occurs to you.
 *
 * This deliberately DECIDES NOTHING. It resolves a frame to its clusters and
 * hands off. A second surface that could name or link would be a second place
 * for the crew-vs-guest rule to drift, and that rule (crew identity is a LINK,
 * never persons.name) is the one that must not bend.
 *
 * One clustered face resolves straight through — a picker showing a single
 * option is a click that teaches nothing. Two or more, and the crops are the
 * question: on a group shot the ONLY honest way to ask "which of these?" is to
 * show the faces, not a list of names most of which are "unnamed".
 */
export interface IdentifyTarget {
  imageId: string;
  thumbnailUrl: string;
  filename?: string;
}

interface FaceEntry {
  faceId: string;
  personId: string | null;
  personName: string | null;
  crewName: string | null;
  photoCount: number | null;
  bbox: { x: number; y: number; w: number; h: number };
}

export function IdentifyPersonPicker({
  target,
  onPick,
  onClose,
}: {
  target: IdentifyTarget;
  /** Open this cluster's panel. The caller owns navigation. */
  onPick: (personId: string) => void;
  onClose: () => void;
}) {
  const [faces, setFaces] = useState<FaceEntry[] | null>(null);
  const [dims, setDims] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/images/${target.imageId}/people`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as {
          faces: FaceEntry[];
          imageWidth: number | null;
          imageHeight: number | null;
        };
        if (!alive) return;
        setDims({ w: body.imageWidth, h: body.imageHeight });
        setFaces(body.faces);
        // Exactly one face WITH a cluster — no question to ask.
        const clustered = body.faces.filter((f) => f.personId);
        if (clustered.length === 1 && body.faces.length === 1) {
          onPick(clustered[0].personId!);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.imageId]);

  const label = (f: FaceEntry) =>
    f.crewName ?? f.personName ?? (f.personId ? "Unnamed" : "Not grouped yet");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg border border-stone-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between">
          <p className="label-caps">
            Who is this?
            {target.filename && (
              <span className="ml-2 normal-case tracking-normal text-stone-400">{target.filename}</span>
            )}
          </p>
          <button onClick={onClose} className="text-stone-400 transition-colors hover:text-stone-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {failed && <p className="text-[13px] text-stone-500">Could not read the faces in this photo.</p>}
        {!failed && faces === null && <p className="text-[13px] text-stone-400">Looking…</p>}

        {faces?.length === 0 && (
          <p className="text-[13px] leading-relaxed text-stone-600">
            No faces were detected in this photo yet. Face detection runs after AI indexing finishes for the
            gallery — if the gallery is still processing, this frame will get there.
          </p>
        )}

        {faces && faces.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {faces.map((f) => {
                const openable = Boolean(f.personId);
                return (
                  <button
                    key={f.faceId}
                    disabled={!openable}
                    onClick={() => f.personId && onPick(f.personId)}
                    title={
                      openable
                        ? `Open this person — rename, link to crew, or split`
                        : "This face has not been grouped into a person yet, so there is nothing to open"
                    }
                    className={
                      "group text-center " +
                      (openable ? "cursor-pointer" : "cursor-not-allowed opacity-50")
                    }
                  >
                    <div
                      className={
                        "relative mx-auto h-16 w-16 overflow-hidden rounded-full bg-stone-100 ring-1 transition-all " +
                        (openable
                          ? "ring-stone-200 group-hover:ring-2 group-hover:ring-emerald-600"
                          : "ring-stone-200")
                      }
                    >
                      <FaceCircleCrop
                        face={{
                          thumbnailUrl: target.thumbnailUrl,
                          bbox: f.bbox,
                          imageWidth: dims.w,
                          imageHeight: dims.h,
                        }}
                      />
                    </div>
                    <span className="mt-1.5 block truncate text-[10px] uppercase tracking-[0.14em] text-stone-500">
                      {label(f)}
                    </span>
                    {f.photoCount != null && (
                      <span className="block text-[10px] text-stone-400">{f.photoCount} photos</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-stone-500">
              Pick a face to open that person, where you can name them, link them to your crew roster, or split
              them apart.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
