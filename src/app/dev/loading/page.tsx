"use client";

import { useState } from "react";
import { ElephantWalk, type ElephantCadence } from "@/components/brand/ElephantWalk";

/**
 * /dev/loading — the walking-elephant playground.
 *
 * Same role as /dev/buttons: judge motion in the browser, where it lives.
 * Cadence and speed are live controls because both are taste calls that are
 * impossible to settle in prose.
 */
/**
 * Stand-ins for the SPS thumbnails the import screen passes in. Local files so
 * this page needs no network and no SPS connection to judge the motion — the
 * only thing being judged here is depth, tilt and cadence.
 */
const PASSING_SAMPLE = [
  "/logo.png",
  "/elephant/body.png",
  "/logo.png",
  "/elephant/trunk.png",
  "/logo.png",
  "/elephant/tail.png",
];

export default function LoadingPlayground() {
  const [cadence, setCadence] = useState<ElephantCadence>("stopmotion");
  const [cycle, setCycle] = useState(1.6);

  return (
    <div className="min-h-screen bg-white px-8 py-16 md:px-16">
      <header className="mb-14">
        <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-tight text-stone-900">
          Walking <span className="font-serif italic text-emerald-600">elephant</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-stone-500">
          A cut-out puppet rig: the logo sliced into seven parts straight from
          its alpha mask, each rotating about its own joint. Every tile is the
          original artwork — nothing redrawn. The gait is lateral sequence
          (left hind, left fore, right hind, right fore) with a slow stance and
          a fast swing; trunk and tail lag a quarter cycle behind.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px]">
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

          <span className="ml-4 uppercase tracking-[0.12em] text-stone-400">Speed</span>
          <input
            type="range"
            min={0.8}
            max={3}
            step={0.1}
            value={cycle}
            onChange={(e) => setCycle(parseFloat(e.target.value))}
            className="w-40 accent-emerald-600"
          />
          <span className="tabular-nums text-stone-400">{cycle.toFixed(1)}s / stride</span>
        </div>
      </header>

      <div className="grid gap-16 lg:grid-cols-2">
        <section>
          <p className="label-caps mb-5">Full size</p>
          <div className="border border-stone-100 p-10">
            <ElephantWalk
              cadence={cadence}
              cycle={cycle}
              message={'Looking for "dancing"…'}
              detail="Reading the photos themselves — this can take a few seconds."
            />
          </div>
        </section>

        <section>
          <p className="label-caps mb-5">
            Carrying photographs — the SPS import wait
          </p>
          <div className="border border-stone-100 p-10">
            <ElephantWalk
              cadence={cadence}
              cycle={cycle}
              passing={PASSING_SAMPLE}
              message="Copying from SimplePhotoShare"
              detail="61 across so far"
            />
          </div>
        </section>

        <section>
          <p className="label-caps mb-5">Inline — the size it ships at</p>
          <div className="max-w-md border border-stone-100 p-8">
            <ElephantWalk
              cadence={cadence}
              cycle={cycle}
              className="[&>div]:max-w-[180px]"
              message="Building your people index…"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
