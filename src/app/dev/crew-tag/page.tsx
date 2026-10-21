"use client";

import { useState } from "react";
import { CrewFaceTag } from "@/components/crew/CrewFaceTag";

/**
 * /dev/crew-tag — the import grid's "That's crew" tag on FIXTURES.
 *
 * The real tile lives on /events/import, which needs a live SPS pull and talks
 * to the production database: tagging there writes a real face reference.
 * This page stubs `fetch` for the three calls the tag makes (whoami, the
 * roster, the faces POST/DELETE), so the save → receipt → Undo loop can be
 * clicked without writing anything. Saves take 600ms; a name containing
 * "Fail" makes the next request fail, to show Retry and a failed Undo.
 *
 * THE NAMES ARE FAKE.
 */

const ROSTER = [
  { id: "c1", display_name: "Robin Example", is_regular: true, kind: null, city: null, archived: false, lastHired: null },
  { id: "c2", display_name: "Sam Sample", is_regular: true, kind: null, city: null, archived: false, lastHired: null },
  { id: "c3", display_name: "Fail Always", is_regular: false, kind: null, city: null, archived: false, lastHired: null },
];

let installed = false;
let refSeq = 0;
function installStub() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/ops/whoami")) return json({ hasIntel: true });
    if (url.endsWith("/api/crew")) return json({ crew: ROSTER });
    const m = url.match(/\/api\/crew\/([^/]+)\/faces$/);
    if (m) {
      await new Promise((r) => setTimeout(r, 600));
      if (m[1] === "c3") return json({ error: "Stubbed failure." }, 500);
      if (init?.method === "DELETE") return json({ faces: [] });
      return json({ id: `ref-${++refSeq}`, faces: [] });
    }
    return real(input, init);
  };
}

export default function CrewTagFixture() {
  installStub();
  const [checked, setChecked] = useState(true);
  const [tagged, setTagged] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  return (
    <main className="mx-auto max-w-xl p-8 font-sans text-stone-800">
      <h1 className="font-editorial text-2xl">Crew tag fixture</h1>
      <p className="mt-1 text-[13px] text-stone-500">Hover the tile, tag a name, then Undo. Nothing is written.</p>
      <div className="group relative mt-6 aspect-square w-[220px] overflow-hidden bg-stone-200">
        <div className={`absolute inset-0 bg-gradient-to-br from-stone-300 to-stone-400 ${checked ? "" : "opacity-30"}`} />
        <CrewFaceTag
          imageUrl="https://example.r2.dev/frame.jpg"
          jobCrewIds={["c1"]}
          onTagStart={(n) => { setChecked(false); note(`start ${n}`); }}
          onTagged={(n) => { setTagged((t) => t + 1); note(`tagged ${n}`); }}
          onTagFailed={(n) => { setChecked(true); note(`failed ${n}`); }}
          onUntagged={(n) => { setTagged((t) => Math.max(0, t - 1)); setChecked(true); note(`untagged ${n}`); }}
        />
      </div>
      <p className="mt-4 text-[13px]" data-testid="state">
        checked: {String(checked)} · moved to crew: {tagged}
      </p>
      <ul className="mt-2 text-[12px] text-stone-500" data-testid="log">
        {log.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </main>
  );
}
