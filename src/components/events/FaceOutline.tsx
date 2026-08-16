"use client";

/**
 * The face ring — "this is the face we mean."
 *
 * The review modals show whole frames, and a group shot renders six faces with
 * nothing marking which one the cluster is claiming. Confirming that card is a
 * blind yes. Mason (2026-08-16): "add an outline box/circle on group shots
 * when in the 'Is this So-and-so' cards … so it's clear who we're identifying
 * as the matched face."
 *
 * Rings render ONLY on frames holding 2+ faces: on a solo portrait the ring is
 * noise, on a group shot it is the answer. Geometry arrives from
 * `/api/people/[personId]/faces`; bboxes are normalized fractions of the
 * original frame (the pipeline divides by width/height at detection time).
 */
import { useEffect, useState } from "react";

export interface PersonFaceGeometry {
  faceId: string;
  imageId: string;
  bbox: { x: number; y: number; w: number; h: number };
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface PersonFaces {
  /** imageId → every face this cluster claims there (1 normally; 2+ = contaminated). */
  byImage: Map<string, PersonFaceGeometry[]>;
  byFaceId: Map<string, PersonFaceGeometry>;
  /** Frames with 2+ faces from anyone — the only place rings render. */
  multiFace: Set<string>;
}

/**
 * Face geometry for one cluster. Best-effort by design: the modals must work
 * exactly as before when this fails or hasn't landed — the ring is an aid,
 * never a gate. `null` while loading or on error.
 */
export function usePersonFaces(personId: string | null | undefined): PersonFaces | null {
  const [data, setData] = useState<PersonFaces | null>(null);
  useEffect(() => {
    if (!personId) {
      setData(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/people/${personId}/faces`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          faces: PersonFaceGeometry[];
          multiFaceImageIds: string[];
        };
        if (!alive) return;
        const byImage = new Map<string, PersonFaceGeometry[]>();
        const byFaceId = new Map<string, PersonFaceGeometry>();
        for (const f of body.faces) {
          byImage.set(f.imageId, [...(byImage.get(f.imageId) ?? []), f]);
          byFaceId.set(f.faceId, f);
        }
        setData({ byImage, byFaceId, multiFace: new Set(body.multiFaceImageIds) });
      } catch {
        // Silent: the modal renders fine without rings.
      }
    })();
    return () => {
      alive = false;
    };
  }, [personId]);
  return data;
}

/**
 * Where the (normalized) bbox lands inside the RENDERED box, as percentages.
 *
 * "natural" — the img keeps its own aspect (`w-full`): percentages map 1:1.
 * "cover-top" — the square tiles (`object-cover object-top`): the browser
 * scales the image to cover, top-aligned, centered horizontally, so the bbox
 * must be remapped through that crop before its percentages mean anything.
 * A face cropped out of view returns null (rather than a ring floating on the
 * wrong pixels).
 */
function ringStyle(
  face: PersonFaceGeometry,
  fit: "natural" | "cover-top"
): React.CSSProperties | null {
  // Pad the tight detector box a little — a ring hugging the chin reads as a
  // targeting reticle; breathing room reads as "this person".
  const pad = 0.18;
  let x = face.bbox.x - face.bbox.w * pad;
  let y = face.bbox.y - face.bbox.h * pad;
  let w = face.bbox.w * (1 + 2 * pad);
  let h = face.bbox.h * (1 + 2 * pad);
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.min(1 - x, w);
  h = Math.min(1 - y, h);

  if (fit === "cover-top") {
    const W = face.imageWidth ?? 0;
    const H = face.imageHeight ?? 0;
    if (!W || !H) return null;
    const A = W / H; // rendered inside a SQUARE tile
    if (A >= 1) {
      // Wider than tall: height fills, sides crop, centered horizontally.
      const cropLeft = (1 - 1 / A) / 2;
      const left = (x - cropLeft) * A;
      const width = w * A;
      if (left + width < 0.02 || left > 0.98) return null; // cropped away
      return {
        left: `${left * 100}%`,
        top: `${y * 100}%`,
        width: `${width * 100}%`,
        height: `${h * 100}%`,
      };
    }
    // Taller than wide: width fills, bottom crops (object-top).
    const visible = A; // fraction of image height the tile shows
    const top = y / visible;
    const height = h / visible;
    if (top > 0.98) return null; // below the crop
    return {
      left: `${x * 100}%`,
      top: `${top * 100}%`,
      width: `${w * 100}%`,
      height: `${height * 100}%`,
    };
  }

  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
  };
}

/**
 * Absolutely-positioned rings for one image. Parent must be `relative` (and
 * `overflow-hidden` for cover-top tiles, which theirs already are). White with
 * a dark halo on both edges — legible on any photo, and deliberately NOT the
 * emerald accent: this marks a face in a photograph, not app state.
 */
export function FaceRings({
  faces,
  fit,
}: {
  faces: PersonFaceGeometry[] | undefined;
  fit: "natural" | "cover-top";
}) {
  if (!faces?.length) return null;
  return (
    <>
      {faces.map((f) => {
        const style = ringStyle(f, fit);
        if (!style) return null;
        return (
          <div
            key={f.faceId}
            className="pointer-events-none absolute rounded-[4px] border-2 border-white/95"
            style={{
              ...style,
              boxShadow: "0 0 0 1.5px rgba(0,0,0,0.45), inset 0 0 0 1.5px rgba(0,0,0,0.35)",
            }}
          />
        );
      })}
    </>
  );
}
