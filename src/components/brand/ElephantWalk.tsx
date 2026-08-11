"use client";

import { useId } from "react";

/**
 * The walking elephant — a cut-out puppet rig of the real logo.
 *
 * `scripts/cut-elephant.mjs` slices `public/logo.png` into seven parts (four
 * legs, trunk, tail, body) straight from the alpha mask, so every tile is the
 * ORIGINAL artwork — nothing is redrawn or approximated. Each part is placed
 * back at its exact source coordinate and rotated about its own joint, which
 * is how cut-out animation has always worked.
 *
 * The gait is the part that decides whether this reads as an elephant:
 *
 *  • **Lateral sequence** — left hind, left fore, right hind, right fore, at
 *    quarter-cycle offsets. Elephants never trot and never gallop; give them a
 *    horse's diagonal gait and it looks wrong in a way nobody can name.
 *  • **Small angular excursion.** Their legs are columnar — they swing maybe
 *    nine degrees, not the thirty a dog uses. Overdo it and you get a cartoon
 *    dachshund.
 *  • **Stance is slower than swing.** Each leg spends ~62% of the cycle
 *    planted and rotating back, then whips forward in the remaining ~38%.
 *    Even timing is the single most common tell of a fake walk cycle.
 *  • **Trunk and tail lag.** They're damped pendulums driven by the body, so
 *    they trail the gait by roughly a quarter cycle. That lag is what reads as
 *    weight rather than as parts sliding on a timeline.
 *
 * Cadence is stop-motion by default (`step-end`, eight held frames): whimsy is
 * the point, and held frames read as hand-made where smooth reads as computed.
 */

/** Source geometry, all relative to the body crop's origin at (203, 350). */
const FRAME = { w: 1180, h: 852 };
const pct = (v: number, axis: "w" | "h") => `${(v / FRAME[axis]) * 100}%`;

interface Part {
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** transform-origin — the joint this part rotates about. */
  origin: string;
}

const PARTS: Record<string, Part> = {
  // Tail sits behind the rump; trunk in front of the head.
  tail: { file: "tail", x: -3, y: 350, w: 82, h: 250, z: 1, origin: "50% 6%" },
  legRearFar: { file: "leg-rear-far", x: 193, y: 530, w: 175, h: 322, z: 2, origin: "50% 20%" },
  legFrontFar: { file: "leg-front-far", x: 757, y: 530, w: 168, h: 322, z: 2, origin: "50% 20%" },
  body: { file: "body", x: 0, y: 0, w: 1180, h: 600, z: 3, origin: "50% 100%" },
  legRearNear: { file: "leg-rear-near", x: 15, y: 530, w: 180, h: 322, z: 4, origin: "50% 20%" },
  legFrontNear: { file: "leg-front-near", x: 537, y: 530, w: 150, h: 322, z: 4, origin: "50% 20%" },
  trunk: { file: "trunk", x: 1027, y: 432, w: 132, h: 280, z: 5, origin: "50% 4%" },
};

/** Deterministic hash → [0,1). No Math.random: SSR and client must agree. */
function rnd(seed: number, n: number): number {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Fill a silhouette with mosaic tiles.
 *
 * This is the LOGO'S OWN TECHNIQUE, not an imitation of its shapes: the mark
 * is a grid of rounded tiles clipped to an elephant, with white grout between
 * them and colour that drifts smoothly across the body rather than landing at
 * random. Applying the same construction to a tree is what makes the two
 * belong to one piece of art. The first attempt drew five big rounded rects
 * beside a hundred-tile mosaic, and the craft mismatch was the whole problem
 * (Mason, 2026-08-10: "the elephant is an art deco piece of art, those trees
 * are child drawing garbage").
 *
 * Coherence comes from indexing the palette by a low-frequency function of
 * position, so neighbouring tiles are near-neighbours in colour and the eye
 * reads zones — exactly what the logo does across the elephant's flank.
 */
function MosaicFill({
  clipId,
  x,
  y,
  w,
  h,
  cell,
  palette,
  seed,
  accents = [],
}: {
  clipId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cell: number;
  palette: string[];
  seed: number;
  /** Rare warm tiles — the logo's pinks and oranges among the blues. */
  accents?: string[];
}) {
  const tiles: React.ReactElement[] = [];
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      k += 1;
      const jx = (rnd(seed, k) - 0.5) * cell * 0.08;
      const jy = (rnd(seed, k + 500) - 0.5) * cell * 0.08;
      // Grout: a HAIRLINE. The logo's tiles sit tight against each other with
      // just enough white to separate them; a wide gap turns a mosaic into
      // scattered confetti and loses the silhouette.
      const inset = cell * (0.03 + rnd(seed, k + 900) * 0.035);
      const tw = cell - inset * 2 + (rnd(seed, k + 1300) - 0.5) * cell * 0.06;
      const th = cell - inset * 2 + (rnd(seed, k + 1700) - 0.5) * cell * 0.06;
      // The mark is NOT a uniform grid — a handful of tiles are two or three
      // cells across, and that size variation is most of its character. Larger
      // tiles are drawn over their neighbours, which is exactly how the
      // original reads: a coarse mosaic with fine work between.
      const big = rnd(seed, k + 4100);
      const scale = big > 0.93 ? 2.6 : big > 0.82 ? 1.9 : 1;
      const tw2 = tw * scale;
      const th2 = th * (scale === 1 ? 1 : rnd(seed, k + 4700) > 0.5 ? scale : 1);
      if (tw2 <= 0.5 || th2 <= 0.5) continue;
      // Smooth drift across the shape + a little noise → zones, not confetti.
      const t =
        (cIdx / cols) * 0.55 +
        (r / rows) * 0.75 +
        rnd(seed, k + 2100) * 0.22;
      const useAccent = accents.length > 0 && rnd(seed, k + 2600) > 0.93;
      const fill = useAccent
        ? accents[Math.floor(rnd(seed, k + 3100) * accents.length)]
        : palette[Math.floor(t * palette.length) % palette.length];
      tiles.push(
        <rect
          key={k}
          x={x + cIdx * cell + inset + jx}
          y={y + r * cell + inset + jy}
          width={tw2}
          height={th2}
          rx={Math.min(tw2, th2) * 0.24}
          fill={fill}
        />
      );
    }
  }
  return <g clipPath={`url(#${clipId})`}>{tiles}</g>;
}

/**
 * An acacia — umbrella canopy, boughs reaching up and out — rendered as a
 * mosaic in the mark's own construction. The silhouette is a path; the colour
 * is tiles clipped to it.
 */
function Acacia({ seed, colors, accents, uid }: { seed: number; colors: string[]; accents: string[]; uid: string }) {
  const id = `acacia${uid}${seed}`;
  const lean = rnd(seed, 7) * 5 - 2.5;
  const spread = 0.9 + rnd(seed, 11) * 0.2;
  const canopyY = 30 + rnd(seed, 13) * 8;
  return (
    <svg viewBox="0 0 140 210" className="h-full w-auto" preserveAspectRatio="xMidYMax meet">
      <defs>
        <clipPath id={`${id}-canopy`}>
          {/* Flat-topped umbrella: near-straight along the top, curving under
              at the edges. That top line is the whole acacia signature. */}
          <path
            d={`M ${70 - 62 * spread} ${canopyY + 26}
                C ${70 - 58 * spread} ${canopyY - 2}, ${70 - 26 * spread} ${canopyY - 11}, 70 ${canopyY - 11}
                C ${70 + 26 * spread} ${canopyY - 11}, ${70 + 58 * spread} ${canopyY - 2}, ${70 + 62 * spread} ${canopyY + 26}
                C ${70 + 40 * spread} ${canopyY + 40}, ${70 + 16 * spread} ${canopyY + 33}, 70 ${canopyY + 36}
                C ${70 - 16 * spread} ${canopyY + 33}, ${70 - 40 * spread} ${canopyY + 40}, ${70 - 62 * spread} ${canopyY + 26} Z`}
          />
        </clipPath>
        <clipPath id={`${id}-trunk`}>
          <path
            d={`M 64 210 L 62 ${canopyY + 62} C 60 ${canopyY + 44}, 44 ${canopyY + 40}, 30 ${canopyY + 22}
                L 36 ${canopyY + 18} C 50 ${canopyY + 34}, 62 ${canopyY + 36}, 66 ${canopyY + 40}
                C 70 ${canopyY + 34}, 84 ${canopyY + 26}, 98 ${canopyY + 14}
                L 103 ${canopyY + 20} C 88 ${canopyY + 34}, 74 ${canopyY + 44}, 72 ${canopyY + 62}
                L 76 210 Z`}
          />
        </clipPath>
      </defs>
      <g transform={`rotate(${lean} 70 210)`}>
        <MosaicFill
          clipId={`${id}-trunk`}
          x={20} y={canopyY + 10} w={100} h={210 - canopyY}
          cell={9} palette={colors.slice(0, 2)} seed={seed + 5}
        />
        <MosaicFill
          clipId={`${id}-canopy`}
          x={0} y={canopyY - 14} w={140} h={62}
          cell={10} palette={colors} accents={accents} seed={seed}
        />
      </g>
    </svg>
  );
}

/**
 * A band of trees sliding past at one depth. Two copies of the same sparse
 * row, slid by exactly half the band width, so the loop is seamless.
 *
 * The whole point of this pass: trees are placed IN FRONT OF or BEHIND the
 * elephant by z-index — the first attempt stacked them above and below it in
 * y, which is a diagram of depth rather than depth itself. A foreground tree
 * genuinely occludes the elephant as it passes.
 */
function TreeBand({
  uid,
  depth,
  anim,
  duration,
  timing,
  colors,
  accents,
  /** Band width as a multiple of the stage — the empty road between events.
   *  ONE tree per copy, so bigger spread = rarer sighting. */
  spread,
  height,
  bottom,
  opacity,
  z,
}: {
  uid: string;
  depth: number;
  anim: string;
  duration: number;
  timing: string;
  colors: string[];
  accents: string[];
  spread: number;
  height: string;
  bottom: string;
  opacity: number;
  z: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 flex"
      style={{
        width: `${spread * 100}%`,
        animation: `${anim} ${duration}s ${timing} infinite`,
        zIndex: z,
        opacity,
      }}
    >
      {[0, 1].map((copy) => (
        <div key={copy} className="relative h-full w-1/2 shrink-0">
          <div
            className="absolute"
            style={{ left: `${18 + copy * 9}%`, bottom, height }}
          >
            <Acacia
              seed={depth * 31 + copy * 7 + 3}
              colors={colors}
              accents={accents}
              uid={uid}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Palettes lifted from the mark. Distance is cool and desaturated, foreground
 * warm and full-strength — aerial perspective, the same reason the far band is
 * also slower and fainter. Accents are the rare warm tiles the logo scatters
 * through its blues.
 */
const TREE_FAR = ["#3a5f8f", "#4a7fb0", "#5b8fc4", "#4aa3df", "#7fa9c9"];
const TREE_FAR_ACCENT = ["#8a7fb5", "#6f93a8"];
const TREE_NEAR = ["#1b3a6b", "#226b60", "#2b7a78", "#5f9455", "#8cb369", "#c7cf5a"];
const TREE_NEAR_ACCENT = ["#f0a92b", "#ef7724", "#e04f6e"];

export type ElephantCadence = "stopmotion" | "smooth";

export function ElephantWalk({
  cadence = "stopmotion",
  /** Seconds per full gait cycle. Elephants are unhurried. */
  cycle = 1.6,
  trees = true,
  message,
  detail,
  className = "",
}: {
  cadence?: ElephantCadence;
  cycle?: number;
  /** Savanna passing at two depths. Off gives the bare walking mark. */
  trees?: boolean;
  message?: string;
  detail?: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ease = cadence === "stopmotion" ? "step-end" : "ease-in-out";

  // Lateral sequence: LH → LF → RH → RF, each a quarter cycle apart. Negative
  // delays start every leg already mid-stride instead of all planted at once.
  const phase: Record<string, number> = {
    legRearNear: 0,
    legFrontNear: 0.25,
    legRearFar: 0.5,
    legFrontFar: 0.75,
  };

  return (
    <div className={`w-full ${className}`}>
      <style>{`
        /* Stance 0→62.5% (slow, rotating back), swing 62.5→100% (fast, forward). */
        @keyframes step${uid} {
          0%    { transform: rotate(-9deg); }
          12.5% { transform: rotate(-5.4deg); }
          25%   { transform: rotate(-1.8deg); }
          37.5% { transform: rotate(1.8deg); }
          50%   { transform: rotate(5.4deg); }
          62.5% { transform: rotate(9deg); }
          75%   { transform: rotate(3deg); }
          87.5% { transform: rotate(-4deg); }
          100%  { transform: rotate(-9deg); }
        }
        /* Two rises per gait cycle — one per lateral pair taking the weight. */
        @keyframes bodyBob${uid} {
          0%    { transform: translateY(0)      rotate(0deg); }
          12.5% { transform: translateY(-0.5%)  rotate(0.25deg); }
          25%   { transform: translateY(-0.9%)  rotate(0.4deg); }
          37.5% { transform: translateY(-0.4%)  rotate(0.15deg); }
          50%   { transform: translateY(0)      rotate(0deg); }
          62.5% { transform: translateY(-0.5%)  rotate(-0.25deg); }
          75%   { transform: translateY(-0.9%)  rotate(-0.4deg); }
          87.5% { transform: translateY(-0.4%)  rotate(-0.15deg); }
          100%  { transform: translateY(0)      rotate(0deg); }
        }
        /* Pendulums. Wider arc than the legs, and lagging — see the note above. */
        @keyframes trunkSwing${uid} {
          0%    { transform: rotate(6deg); }
          25%   { transform: rotate(1deg); }
          50%   { transform: rotate(-6deg); }
          75%   { transform: rotate(-1deg); }
          100%  { transform: rotate(6deg); }
        }
        @keyframes tailSwing${uid} {
          0%    { transform: rotate(-7deg); }
          25%   { transform: rotate(-2deg); }
          50%   { transform: rotate(7deg); }
          75%   { transform: rotate(2deg); }
          100%  { transform: rotate(-7deg); }
        }
        @keyframes drift${uid} { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes rush${uid}  { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .rig${uid} * { animation: none !important; }
        }
      `}</style>

      <div
        className={`rig${uid} relative mx-auto w-full ${trees ? "max-w-[520px] overflow-hidden" : "max-w-[300px]"}`}
        style={{ aspectRatio: trees ? "16 / 10" : `${FRAME.w} / ${FRAME.h}` }}
      >
        {trees && (
          <TreeBand
            uid={uid}
            depth={1}
            anim={`drift${uid}`}
            duration={78}
            timing={cadence === "stopmotion" ? "steps(64, end)" : "linear"}
            colors={TREE_FAR}
            accents={TREE_FAR_ACCENT}
            spread={8}
            height="30%"
            bottom="27%"
            opacity={0.34}
            z={0}
          />
        )}

        {/* The elephant. With trees on, it's inset into the stage so the
            foreground band has somewhere nearer-than-it to pass through. */}
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={
            trees
              ? { bottom: "16%", width: "50%", aspectRatio: `${FRAME.w} / ${FRAME.h}`, zIndex: 5 }
              : { inset: 0, transform: "none", width: "100%", height: "100%", zIndex: 5 }
          }
        >
        {Object.entries(PARTS).map(([key, p]) => {
          const isLeg = key.startsWith("leg");
          const anim = isLeg
            ? `step${uid} ${cycle}s ${ease} infinite`
            : key === "body"
              ? `bodyBob${uid} ${cycle}s ${ease} infinite`
              : key === "trunk"
                ? `trunkSwing${uid} ${cycle}s ${ease} infinite`
                : `tailSwing${uid} ${cycle}s ${ease} infinite`;
          // Trunk and tail lag the gait by a quarter cycle.
          const delay = isLeg
            ? -phase[key] * cycle
            : key === "trunk"
              ? -0.25 * cycle
              : key === "tail"
                ? -0.6 * cycle
                : 0;
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={key}
              src={`/elephant/${p.file}.png`}
              alt=""
              className="absolute select-none"
              style={{
                left: pct(p.x, "w"),
                top: pct(p.y, "h"),
                width: pct(p.w, "w"),
                height: pct(p.h, "h"),
                zIndex: p.z,
                transformOrigin: p.origin,
                animation: anim,
                animationDelay: `${delay}s`,
              }}
            />
          );
        })}
        </div>

        {/* Foreground: bigger, faster, rooted BELOW the elephant, and above it
            in z — so it sweeps across and briefly hides him. That occlusion is
            the entire difference between depth and a picture of depth. */}
        {trees && (
          <TreeBand
            uid={uid}
            depth={2}
            anim={`rush${uid}`}
            duration={34}
            timing={cadence === "stopmotion" ? "steps(46, end)" : "linear"}
            colors={TREE_NEAR}
            accents={TREE_NEAR_ACCENT}
            spread={8}
            height="58%"
            bottom="-6%"
            opacity={1}
            z={9}
          />
        )}
      </div>

      {(message || detail) && (
        <div className="mt-6 text-center">
          {message && (
            <p className="animate-pulse text-[14px] italic text-stone-500">{message}</p>
          )}
          {detail && <p className="mt-1.5 text-[11px] text-stone-400">{detail}</p>}
        </div>
      )}
    </div>
  );
}
