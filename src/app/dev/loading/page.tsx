"use client";

import { useState } from "react";
import {
  ElephantWalk,
  type ElephantCadence,
  type ElephantScene,
} from "@/components/brand/ElephantWalk";

/**
 * /dev/loading — the loading-elephant playground.
 *
 * Same role as /dev/buttons: a preserved artifact for judging motion in the
 * browser, where it actually lives, instead of arguing about it in prose.
 * Three scenes × two cadences, side by side and full size.
 */
const SCENES: { key: ElephantScene; label: string; note: string }[] = [
  {
    key: "savanna",
    label: "Savanna",
    note: "Warm horizon, the mark's full spectrum. The most 'story'.",
  },
  {
    key: "editorial",
    label: "Editorial",
    note: "Stone and emerald only. Disappears into the app; never upstages a gallery.",
  },
  {
    key: "mosaic",
    label: "Mosaic",
    note: "Cool spectrum, playful. Reads as the logo's world.",
  },
];

export default function LoadingPlayground() {
  const [cadence, setCadence] = useState<ElephantCadence>("stopmotion");

  return (
    <div className="min-h-screen bg-white px-8 py-16 md:px-16">
      <header className="mb-12">
        <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-tight text-stone-900">
          Loading <span className="font-serif italic text-emerald-600">elephant</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-stone-500">
          A tracking shot: the elephant is held in frame while the world moves
          past at three speeds. The logo is the real file, never redrawn — the
          walk comes from the bob and from the shadow squashing underneath it.
        </p>

        <div className="mt-6 flex items-center gap-4 text-[12px]">
          <span className="uppercase tracking-[0.12em] text-stone-400">Cadence</span>
          {(["stopmotion", "smooth"] as ElephantCadence[]).map((c) => (
            <button
              key={c}
              onClick={() => setCadence(c)}
              className={`uppercase tracking-[0.12em] transition-colors ${
                cadence === c ? "text-emerald-700" : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {c === "stopmotion" ? "Stop-motion" : "Smooth"}
            </button>
          ))}
          <span className="text-stone-300">
            {cadence === "stopmotion"
              ? "· held poses, ~8fps, bands stepping on 13/11/7"
              : "· continuous, the original take"}
          </span>
        </div>
      </header>

      <div className="grid gap-14 lg:grid-cols-2 2xl:grid-cols-3">
        {SCENES.map((s) => (
          <section key={s.key}>
            <p className="label-caps mb-1">{s.label}</p>
            <p className="mb-5 text-[12px] text-stone-400">{s.note}</p>
            <div className="border border-stone-100 p-6">
              <ElephantWalk
                scene={s.key}
                cadence={cadence}
                message={'Looking for "dancing"…'}
                detail="Reading the photos themselves — this can take a few seconds."
              />
            </div>
          </section>
        ))}
      </div>

      <section className="mt-16 border-t border-stone-100 pt-10">
        <p className="label-caps mb-5">Inline — the size it would appear at</p>
        <div className="max-w-md border border-stone-100 p-6">
          <ElephantWalk scene="editorial" cadence={cadence} message="Building your people index…" />
        </div>
      </section>
    </div>
  );
}
