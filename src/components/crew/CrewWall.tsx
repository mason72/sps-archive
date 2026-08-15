"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CrewAvatar, type CrewAvatarFace } from "./CrewAvatar";

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
        if (rows.length) {
          const ids = rows.map((c) => c.id).join(",");
          const av = await fetch(`/api/crew/avatars?ids=${ids}`);
          if (av.ok && live) setAvatars((await av.json()).avatars ?? {});
        }
      } catch {
        /* nothing to show is the correct failure mode here */
      }
    })();
    return () => { live = false; };
  }, []);

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
          {visible.map((c) => (
            <Link
              key={c.id}
              href="/intel"
              className="group flex flex-col items-center text-center"
              title={`${c.display_name} — open in Intel`}
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
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
