"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";

export interface Person {
  id: string;
  name: string | null;
  faceCount: number;
  imageIds: string[];
  face: {
    thumbnailUrl: string;
    bbox: { x: number; y: number; w: number; h: number };
    imageWidth: number | null;
    imageHeight: number | null;
  } | null;
}

/**
 * PeopleView — the editor's face grid. Every clustered person as a zoomed
 * face crop; click filters the photo grid to that person, click the name to
 * rename (names make a person permanent — clustering never deletes them).
 */
export function PeopleView({
  eventId,
  activePersonId,
  onSelectPerson,
}: {
  eventId: string;
  activePersonId: string | null;
  onSelectPerson: (person: Person | null) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/events/${eventId}/people`);
      if (!res.ok) throw new Error(`people ${res.status}`);
      const data = (await res.json()) as { people: Person[] };
      setPeople(data.people);
    } catch {
      setFailed(true);
      setPeople([]);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (people === null) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square bg-stone-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="text-center py-16 text-[13px] text-stone-400">
        Couldn&apos;t load people.{" "}
        <button onClick={load} className="underline hover:text-stone-600">
          Retry
        </button>
      </p>
    );
  }

  if (!people.length) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <Users className="h-8 w-8 text-stone-200 mb-4" />
        <p className="font-editorial text-xl text-stone-300 italic mb-2">
          No people yet
        </p>
        <p className="text-[13px] text-stone-400 max-w-sm">
          Faces group into people automatically a little while after photos
          finish uploading.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-6">
      {people.map((person) => (
        <PersonCard
          key={person.id}
          person={person}
          active={person.id === activePersonId}
          onClick={() =>
            onSelectPerson(person.id === activePersonId ? null : person)
          }
          onRenamed={(name) =>
            setPeople((prev) =>
              prev ? prev.map((p) => (p.id === person.id ? { ...p, name } : p)) : prev
            )
          }
        />
      ))}
    </div>
  );
}

function PersonCard({
  person,
  active,
  onClick,
  onRenamed,
}: {
  person: Person;
  active: boolean;
  onClick: () => void;
  onRenamed: (name: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.name ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    setEditing(false);
    const name = draft.trim() || null;
    if (name === person.name) return;
    onRenamed(name); // optimistic
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onRenamed(person.name);
      toast.error("Couldn't save the name");
    }
  };

  return (
    <div className="group">
      <button
        onClick={onClick}
        className={`relative block w-full aspect-square overflow-hidden bg-stone-100 transition-all duration-300 ${
          active
            ? "ring-2 ring-accent ring-offset-2"
            : "hover:ring-1 hover:ring-stone-300 hover:ring-offset-2"
        }`}
      >
        {person.face ? <FaceCrop face={person.face} /> : null}
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/55 text-white text-[10px] tabular-nums">
          {person.faceCount}
        </span>
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(person.name ?? "");
              setEditing(false);
            }
          }}
          className="mt-2 w-full text-[12px] text-stone-900 bg-transparent border-b border-stone-300 focus:border-stone-900 focus:outline-none"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(person.name ?? "");
            setEditing(true);
          }}
          title="Rename"
          className={`mt-2 block w-full truncate text-left text-[12px] transition-colors ${
            person.name
              ? "text-stone-700 hover:text-stone-900"
              : "text-stone-300 italic hover:text-stone-500"
          }`}
        >
          {person.name ?? "Add name"}
        </button>
      )}
    </div>
  );
}

/**
 * Zoomed face crop: position the full thumbnail inside a square window so the
 * face box sits centered at ~half the tile. Pure CSS percentages — no canvas.
 */
function FaceCrop({ face }: { face: NonNullable<Person["face"]> }) {
  const W = face.imageWidth ?? 800;
  const H = face.imageHeight ?? 533;
  const { x, y, w, h } = face.bbox;
  // Visible square window (in image px): the face box × 2, clamped so we
  // never zoom past the image bounds.
  const winPx = Math.min(Math.max(w * W, h * H) * 2, Math.min(W, H));
  const widthPct = (W / winPx) * 100;
  const heightPct = (H / winPx) * 100;
  const cx = (x + w / 2) * W;
  const cy = (y + h / 2) * H;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const leftPct = clamp(50 - (cx / winPx) * 100, 100 - widthPct, 0);
  const topPct = clamp(50 - (cy / winPx) * 100, 100 - heightPct, 0);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={face.thumbnailUrl}
      alt=""
      loading="lazy"
      className="absolute max-w-none"
      style={{
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    />
  );
}
