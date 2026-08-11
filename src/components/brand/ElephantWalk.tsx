"use client";

import { useId } from "react";

/**
 * The loading elephant — a tracking shot.
 *
 * The elephant is held in frame and the WORLD moves past: far treeline barely
 * drifting, mid trees at a middle rate, foreground grass whipping by. That
 * spread of speeds is what reads as depth, and holding the subject still is
 * what lets the loop run forever without it having to arrive anywhere.
 *
 * Two rules shaped every decision here:
 *
 * 1. **The logo is never redrawn.** `/logo.png` is the real mark, used as a
 *    rigid body — it already stands mid-stride. The walk comes from a gentle
 *    bob and from a ground shadow that squashes in antiphase, which is the
 *    old animation trick of letting the shadow do the walking. Articulating
 *    its legs would mean approximating the logo, which we don't do.
 * 2. **The scenery speaks the logo's language.** Trees are built from the same
 *    rounded-rect tiles, in colors sampled from the mark itself — so the world
 *    is obviously *of* the elephant without copying it.
 *
 * Cadence is STOP-MOTION by default — the whole thing advances in held poses
 * at roughly 8fps, like a flip-book. The first draft ran smooth on the theory
 * that stepping would fight the mark's soft rounded geometry; that was the
 * wrong axis. Smooth reads as *computed*. Held frames read as *made by
 * someone*, and whimsy is the point of putting an elephant in a spinner at
 * all. `cadence="smooth"` keeps the original for comparison.
 *
 * The trick that makes it feel hand-cranked rather than merely low-framerate:
 * the three parallax bands step on DIFFERENT counts (13/11/7), so their jumps
 * drift in and out of sync instead of locking into one machine pulse.
 *
 * Everything is CSS transforms over inline SVG — no library, no raster,
 * GPU-composited, and it costs nothing on a phone. `prefers-reduced-motion`
 * stops the world and leaves the elephant breathing, because sustained
 * parallax is a real nausea trigger for some people.
 */

export type ElephantScene = "savanna" | "editorial" | "mosaic";

/** Sampled from logo.png — the mark's own spectrum, nothing invented. */
const PALETTE = {
  deepBlue: "#1b3a6b",
  blue: "#2b6cb0",
  skyBlue: "#4aa3df",
  teal: "#2b7a78",
  green: "#8cb369",
  olive: "#c7cf5a",
  amber: "#f0a92b",
  orange: "#ef7724",
  rose: "#e04f6e",
  plum: "#5b4b8a",
  sand: "#f0d9a8",
};

/** One tile — the logo's unit of construction. */
function Tile({
  x,
  y,
  w,
  h,
  fill,
  opacity = 1,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  opacity?: number;
}) {
  return (
    <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.22} fill={fill} opacity={opacity} />
  );
}

/**
 * A tree, assembled from tiles. `seed` varies the canopy so a repeating strip
 * doesn't read as wallpaper — the same three trees marching past is the thing
 * that breaks the illusion fastest.
 */
function TileTree({
  x,
  scale,
  seed,
  colors,
  opacity,
}: {
  x: number;
  scale: number;
  seed: number;
  colors: string[];
  opacity: number;
}) {
  // Deterministic pseudo-variation — no Math.random, so SSR and client agree.
  const wobble = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  // Short, sturdy trunk. The first pass gave these long thin stems and a
  // canopy floating clear of the top, which read as lollipops rather than
  // trees — the tiles have to OVERLAP the trunk to fuse into a mass.
  const trunkH = 15 + wobble(1) * 7;
  const canopy = [
    { dx: -13, dy: -6, w: 15, h: 13 },
    { dx: -2, dy: -9, w: 17, h: 15 },
    { dx: 9, dy: -5, w: 14, h: 12 },
    { dx: -6, dy: -17, w: 13, h: 12 },
    { dx: 4, dy: -18, w: 12, h: 11 },
  ];
  return (
    <g transform={`translate(${x} 0) scale(${scale})`} opacity={opacity}>
      <Tile x={-3.5} y={-trunkH} w={7} h={trunkH} fill={colors[0]} />
      {canopy.map((c, i) => (
        <Tile
          key={i}
          x={c.dx + wobble(i + 2) * 3 - 1.5}
          y={-trunkH + c.dy}
          w={c.w}
          h={c.h}
          fill={colors[(i + seed) % colors.length]}
          opacity={0.88 + wobble(i + 7) * 0.12}
        />
      ))}
    </g>
  );
}

/** One seamless parallax band: the strip is drawn twice and slid by exactly
 *  its own width, so the loop has no seam to spot. */
function ParallaxBand({
  animName,
  timing,
  duration,
  y,
  trees,
  width,
}: {
  animName: string;
  /** `steps(n, end)` for the flip-book cadence, or `linear` for smooth. */
  timing: string;
  duration: number;
  y: number;
  trees: { x: number; scale: number; seed: number; colors: string[]; opacity: number }[];
  width: number;
}) {
  return (
    <g style={{ animation: `${animName} ${duration}s ${timing} infinite` }}>
      {[0, 1].map((copy) => (
        <g key={copy} transform={`translate(${copy * width} ${y})`}>
          {trees.map((t, i) => (
            <TileTree key={i} {...t} />
          ))}
        </g>
      ))}
    </g>
  );
}

const SCENES: Record<
  ElephantScene,
  {
    sky: [string, string];
    ground: string;
    far: string[];
    mid: string[];
    near: string[];
    label: string;
  }
> = {
  savanna: {
    sky: ["#fdf6ec", "#f7e2c0"],
    ground: "#e8d4ae",
    far: [PALETTE.deepBlue, PALETTE.plum, PALETTE.blue],
    mid: [PALETTE.teal, PALETTE.green, PALETTE.blue],
    near: [PALETTE.olive, PALETTE.amber, PALETTE.orange],
    label: "Savanna — warm horizon, full spectrum",
  },
  editorial: {
    sky: ["#ffffff", "#f5f5f4"],
    ground: "#e7e5e4",
    far: ["#d6d3d1", "#e7e5e4"],
    mid: ["#a8a29e", "#d6d3d1"],
    near: ["#10b981", "#78716c"],
    label: "Editorial — stone and emerald, restrained",
  },
  mosaic: {
    sky: ["#ffffff", "#eef2f7"],
    ground: "#dde5ee",
    far: [PALETTE.skyBlue, PALETTE.blue, PALETTE.plum],
    mid: [PALETTE.rose, PALETTE.amber, PALETTE.teal],
    near: [PALETTE.orange, PALETTE.green, PALETTE.rose],
    label: "Mosaic — the mark's own spectrum, playful",
  },
};

const BAND_WIDTH = 420;

function bandTrees(colors: string[], count: number, scale: number, opacity: number) {
  return Array.from({ length: count }, (_, i) => ({
    x: (BAND_WIDTH / count) * i + (i % 3) * 11,
    scale,
    seed: i + 1,
    colors,
    opacity,
  }));
}

export type ElephantCadence = "stopmotion" | "smooth";

export function ElephantWalk({
  scene = "savanna",
  cadence = "stopmotion",
  message,
  detail,
  className = "",
}: {
  scene?: ElephantScene;
  cadence?: ElephantCadence;
  /** The primary line — e.g. Looking for "dancing"… */
  message?: string;
  /** The quieter second line explaining the wait. */
  detail?: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const s = SCENES[scene];
  const far = `far${uid}`;
  const mid = `mid${uid}`;
  const near = `near${uid}`;

  // Deliberately coprime step counts. Equal counts would make all three bands
  // jump on the same tick, which reads as one mechanism; drifting counts read
  // as three things being moved by hand.
  const step = (n: number) => (cadence === "stopmotion" ? `steps(${n}, end)` : "linear");
  // The body cycle holds discrete poses (step-end) rather than easing between
  // them — this is the single biggest contributor to the flip-book feel.
  const bodyEase = cadence === "stopmotion" ? "step-end" : "ease-in-out";
  const bodyDur = cadence === "stopmotion" ? 0.96 : 1.15;

  return (
    <div className={`w-full ${className}`}>
      <style>{`
        @keyframes ${far}  { from { transform: translateX(0);            } to { transform: translateX(-${BAND_WIDTH}px); } }
        @keyframes ${mid}  { from { transform: translateX(0);            } to { transform: translateX(-${BAND_WIDTH}px); } }
        @keyframes ${near} { from { transform: translateX(0);            } to { transform: translateX(-${BAND_WIDTH}px); } }
        /* Eight held poses. Uneven spacing (the dip lingers, the lift snaps)
           is what keeps it from feeling like a metronome — a hand-cranked
           camera never lands on exact eighths. */
        /* The baseline 23% is not decoration: logo.png carries roughly that
           much transparent padding below the elephant's feet, so an untranslated
           mark hovers above the ground it is supposedly walking on. Percentages
           resolve against the element's own height, so this stays correct at
           every size. The bob varies around that baseline. */
        @keyframes bob${uid} {
          0%   { transform: translateY(23%)    rotate(-0.5deg); }
          12%  { transform: translateY(22.4%)  rotate(-0.2deg); }
          26%  { transform: translateY(21.8%)  rotate(0.3deg);  }
          38%  { transform: translateY(22.1%)  rotate(0.5deg);  }
          52%  { transform: translateY(23%)    rotate(0.2deg);  }
          64%  { transform: translateY(22.3%)  rotate(-0.3deg); }
          80%  { transform: translateY(21.8%)  rotate(-0.5deg); }
          92%  { transform: translateY(22.7%)  rotate(-0.3deg); }
          100% { transform: translateY(23%)    rotate(-0.5deg); }
        }
        /* Antiphase with the bob: the shadow tightens as the body lifts.
           This is what sells the step — the elephant itself never deforms. */
        @keyframes tread${uid} {
          0%   { transform: scaleX(1);    opacity: .26; }
          26%  { transform: scaleX(.86);  opacity: .15; }
          52%  { transform: scaleX(1);    opacity: .26; }
          80%  { transform: scaleX(.88);  opacity: .16; }
          100% { transform: scaleX(1);    opacity: .26; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pt-walk-${uid} * { animation-duration: 0s !important; animation-iteration-count: 1 !important; }
          .pt-breathe-${uid} { animation: bob${uid} 4s ease-in-out infinite !important; }
        }
      `}</style>

      <div className={`pt-walk-${uid} relative mx-auto w-full max-w-[420px]`}>
        <svg viewBox="0 0 420 180" className="w-full" role="presentation">
          <defs>
            <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.sky[0]} />
              <stop offset="100%" stopColor={s.sky[1]} />
            </linearGradient>
            <clipPath id={`frame${uid}`}>
              <rect x="0" y="0" width="420" height="180" rx="2" />
            </clipPath>
          </defs>

          <g clipPath={`url(#frame${uid})`}>
            <rect x="0" y="0" width="420" height="180" fill={`url(#sky${uid})`} />

            {/* Far treeline — barely moving, which is what makes it far. */}
            <ParallaxBand
              animName={far}
              timing={step(13)}
              duration={26}
              y={132}
              width={BAND_WIDTH}
              trees={bandTrees(s.far, 7, 0.8, 0.35)}
            />
            {/* Mid trees */}
            <ParallaxBand
              animName={mid}
              timing={step(11)}
              duration={13}
              y={143}
              width={BAND_WIDTH}
              trees={bandTrees(s.mid, 5, 1.15, 0.6)}
            />

            {/* Ground */}
            <rect x="0" y="143" width="420" height="37" fill={s.ground} />

            {/* Foreground grass — fastest, and cropped by the frame so it
                reads as passing THROUGH the shot rather than sitting in it. */}
            <ParallaxBand
              animName={near}
              timing={step(7)}
              duration={5.5}
              y={186}
              width={BAND_WIDTH}
              trees={bandTrees(s.near, 9, 0.42, 0.9)}
            />
          </g>
        </svg>

        {/* The mark itself — real file, rigid body, held in frame.
            The wrapper's bottom edge IS the ground line (the SVG puts it at
            y=143 of 180, i.e. 20.5% up from the bottom), and the bob's 23%
            baseline drops the elephant's feet onto exactly that edge. */}
        <div
          className="pointer-events-none absolute inset-0 flex items-end justify-center"
          style={{ paddingBottom: "20.5%" }}
        >
          <div className="relative w-[36%] min-w-[120px] max-w-[168px]">
            {/* The shadow sits ON the ground line and never moves; only its
                width and weight change, which is what reads as weight
                transferring from foot to foot. */}
            <div
              className="absolute left-1/2 h-[7px] w-[70%] -translate-x-1/2 rounded-[50%] bg-stone-900"
              style={{
                bottom: "-3px",
                animation: `tread${uid} ${bodyDur}s ${bodyEase} infinite`,
                filter: "blur(3px)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt=""
              className={`pt-breathe-${uid} relative w-full select-none`}
              style={{ animation: `bob${uid} ${bodyDur}s ${bodyEase} infinite` }}
            />
          </div>
        </div>
      </div>

      {(message || detail) && (
        <div className="mt-5 text-center">
          {message && (
            <p className="animate-pulse text-[14px] italic text-stone-500">{message}</p>
          )}
          {detail && <p className="mt-1.5 text-[11px] text-stone-400">{detail}</p>}
        </div>
      )}
    </div>
  );
}
