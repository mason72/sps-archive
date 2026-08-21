"use client";

import { useState } from "react";
import Link from "next/link";
import { BulkComposer } from "@/components/intel/BulkComposer";
import type { IntelNote } from "@/lib/intel-notes/store";

/**
 * The bulk screen. Photos first; every photo gets its own venue, client and
 * gig (see BulkComposer). After a save the receipt says where things went,
 * per subject, with links.
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
          Drop everything — years of it. Each photo gets its own venue, client and gig right
          beside it; they line up by date and place so one gig’s shots sit together.
        </p>
      </header>

      <BulkComposer onSaved={(notes) => setSaved((s) => [notes, ...s])} />

      {saved.length > 0 && (
        <section className="mt-8">
          <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Saved</span>
          <ul className="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {saved.flatMap((batch, bi) => {
              const groups = new Map<string, typeof batch>();
              for (const n of batch) {
                const k = `${n.event?.id ?? ""}|${n.venue?.id ?? ""}|${n.org?.id ?? ""}`;
                groups.set(k, [...(groups.get(k) ?? []), n]);
              }
              return [...groups.entries()].map(([k, ns]) => {
                const first = ns[0];
                return (
                  <li key={`${bi}-${k}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
                    <span className="text-stone-800">{ns.length} photo{ns.length === 1 ? "" : "s"}</span>
                    <span className="flex flex-wrap gap-3 text-stone-500">
                      {first.venue && <Link href={`/intel?axis=venues&id=${first.venue.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.venue.name}</Link>}
                      {first.org && <Link href={`/intel?axis=clients&id=${first.org.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.org.name}</Link>}
                      {first.event && <Link href={`/events/${first.event.id}`} className="underline underline-offset-4 hover:text-stone-800">{first.event.name}</Link>}
                    </span>
                  </li>
                );
              });
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
