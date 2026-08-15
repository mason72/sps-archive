"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CrewAvatar, type CrewAvatarFace } from "./CrewAvatar";
import { CrewFacesSection } from "./CrewFacesSection";

/**
 * The crew's own row on /people — between the wall of fame and everyone else.
 *
 * Mason: "a section between the guest hall of fame and all faces where we can
 * see crew faces, with a toggle for the section to show regulars (default) |
 * non-regulars | All." Regulars first because this page is "a sort of 'trophy
 * room' so I think it will be fun to go there and see our colleagues first,
 * not randoms" — the memory-jog case ("who was that stylist?") is one click
 * away on the toggle.
 *
 * SELF-GATING. /people is open to every signed-in account, but the roster is
 * crew data: both fetches go through Intel-gated routes, a 403 leaves the
 * component rendering NOTHING, and no crew name or face ever reaches an
 * account the feature does not belong to. The section simply does not exist
 * for them — same posture as the Intel tab on the event page.
 */

interface CrewRow {
  id: string;
  display_name: string;
  city: string | null;
  is_regular: boolean;
  eventCount: number;
}

type Show = "regulars" | "non-regulars" | "all";

export function CrewWall() {
  const [crew, setCrew] = useState<CrewRow[] | null>(null);
  const [avatars, setAvatars] = useState<Record<string, CrewAvatarFace | null>>({});
  const [show, setShow] = useState<Show>("regulars");
  /** The person card — Mason: "when we click on them we should see the empty
      person card with some way to add a photo." */
  const [openId, setOpenId] = useState<string | null>(null);

  const loadAvatars = useCallback(async (rows: CrewRow[]) => {
    if (!rows.length) return;
    try {
      const av = await fetch(`/api/crew/avatars?ids=${rows.map((c) => c.id).join(",")}`);
      if (av.ok) setAvatars((await av.json()).avatars ?? {});
    } catch {
      /* initials stand in */
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/crew");
        if (!res.ok) return; // 403 = not this account's feature: render nothing
        const j = await res.json();
        if (!live) return;
        const rows: CrewRow[] = j.crew ?? [];
        setCrew(rows);
        await loadAvatars(rows);
      } catch {
        /* nothing to show is the correct failure mode here */
      }
    })();
    return () => { live = false; };
  }, [loadAvatars]);

  const visible = useMemo(() => {
    if (!crew) return [];
    if (show === "regulars") return crew.filter((c) => c.is_regular);
    if (show === "non-regulars") return crew.filter((c) => !c.is_regular);
    return crew;
  }, [crew, show]);

  if (!crew?.length) return null;

  return (
    <section className="mb-16">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <p className="label-caps">Your crew</p>
        <div className="flex items-center gap-3 text-[12px]">
          {([
            ["regulars", "Regulars"],
            ["non-regulars", "Non-regulars"],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setShow(value)}
              className={`uppercase tracking-[0.12em] transition-colors ${
                show === value ? "text-emerald-700" : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-[13px] text-stone-400">Nobody on this cut of the roster.</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
          {/**
           * Faceless crew show ON PURPOSE — the initials circle is an absence
           * you can see, which makes this wall double as the seeding
           * checklist. Clicking any tile opens the person card, so the fix for
           * an empty circle is one click away from noticing it.
           */}
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className="group flex flex-col items-center text-center"
              title={c.display_name}
            >
              <CrewAvatar
                face={avatars[c.id]}
                name={c.display_name}
                size={72}
                className="transition-transform duration-200 group-hover:scale-[1.04]"
              />
              <span className="mt-2 max-w-full truncate text-[12px] leading-tight text-stone-700">
                {c.is_regular && <span className="mr-1 text-accent">★</span>}
                {c.display_name}
              </span>
              <span className="text-[11px] text-stone-400">
                {c.city ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <CrewCardModal
          person={crew.find((c) => c.id === openId) ?? null}
          avatar={avatars[openId] ?? null}
          onClose={() => setOpenId(null)}
          onAvatarChange={() => crew && loadAvatars(crew)}
        />
      )}
    </section>
  );
}

/**
 * The person card, on the page you clicked them from.
 *
 * Mason: "when we click on them we should see the empty person card with some
 * way to add a photo." The card IS the Intel panel's Faces section wearing a
 * modal — same reference strip, same upload, same find-in-archive, so there is
 * exactly one implementation of the crew-face controls. Full roster editing
 * stays on /intel; a link at the bottom goes there for it.
 */
function CrewCardModal({
  person,
  avatar,
  onClose,
  onAvatarChange,
}: {
  person: CrewRow | null;
  avatar: CrewAvatarFace | null;
  onClose: () => void;
  onAvatarChange: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!person) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto bg-white p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center gap-4">
          <CrewAvatar face={avatar} name={person.display_name} size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="font-editorial text-[24px] leading-tight text-stone-900">
              {person.is_regular && (
                <span className="mr-1.5 align-middle text-[15px] text-accent" title="A regular">★</span>
              )}
              {person.display_name}
            </h2>
            <p className="mt-0.5 text-[13px] text-stone-500">
              {person.city ?? "no location on file"}
              {person.eventCount > 0 &&
                ` · ${person.eventCount} gig${person.eventCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-stone-300 transition-colors hover:text-stone-600"
          >
            ×
          </button>
        </div>

        <CrewFacesSection
          crewId={person.id}
          crewName={person.display_name}
          onAvatarChange={onAvatarChange}
        />

        <p className="mt-6 border-t border-stone-100 pt-4 text-[12px] text-stone-400">
          Roles, ratings and details live on{" "}
          <a href="/intel" className="underline underline-offset-4 transition-colors hover:text-stone-700">
            Intel
          </a>
          .
        </p>
      </div>
    </div>
  );
}
