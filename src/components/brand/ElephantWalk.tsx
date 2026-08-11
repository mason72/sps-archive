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

export type ElephantCadence = "stopmotion" | "smooth";

export function ElephantWalk({
  cadence = "stopmotion",
  /** Seconds per full gait cycle. Elephants are unhurried. */
  cycle = 1.6,
  message,
  detail,
  className = "",
}: {
  cadence?: ElephantCadence;
  cycle?: number;
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
        @media (prefers-reduced-motion: reduce) {
          .rig${uid} * { animation: none !important; }
        }
      `}</style>

      <div
        className={`rig${uid} relative mx-auto w-full max-w-[300px]`}
        style={{ aspectRatio: `${FRAME.w} / ${FRAME.h}` }}
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
