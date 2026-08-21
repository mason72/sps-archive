"use client";

import { useState } from "react";
import Link from "next/link";
import { NoteComposer } from "@/components/intel/NoteComposer";
import type { IntelNote } from "@/lib/intel-notes/store";

/**
 * The bulk screen. Nothing is known up front; the photos and the pickers
 * supply it. After a save the receipt says where things went, with links —
 * and the composer is immediately ready for the next batch, because a
 * camera roll is several venues.
 */
export function BulkNotes() {
  const [saved, setSaved] = useState<IntelNote[][]>([]);

  return (
    <div>
      <header className="pb-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-400">
          <Link href="/intel" className="hover:text-stone-700">Intel</Link> · Behind the scenes
        </p>
        <h1 className="mt-2 font-editorial text-[32px] leading-tight text-stone-900">Add notes &amp; BTS photos</h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-stone-500">
          Drop photos from a gig, say which venue or client they’re about, caption the ones
          worth a sentence. Photos with a date and a location will suggest the gig and the venue.
        </p>
      </header>

      <NoteComposer onSaved={(notes) => setSaved((s) => [notes, ...s])} />

      {saved.length > 0 && (
        <section className="mt-8">
          <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Saved</span>
          <ul className="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {saved.map((batch, i) => {
              const first = batch[0];
              const photos = batch.filter((n) => n.thumbUrl).length;
              const texts = batch.length - photos;
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <span className="text-stone-800">
                    {photos > 0 && `${photos} photo${photos === 1 ? "" : "s"}`}
                    {photos > 0 && texts > 0 && " and "}
                    {texts > 0 && `${texts} note${texts === 1 ? "" : "s"}`}
                  </span>
                  <span className="flex flex-wrap gap-3 text-stone-500">
                    {first?.venue && <Link href={`/intel?axis=venues&id=${first.venue.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.venue.name}</Link>}
                    {first?.org && <Link href={`/intel?axis=clients&id=${first.org.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.org.name}</Link>}
                    {first?.event && <Link href={`/events/${first.event.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.event.name}</Link>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
