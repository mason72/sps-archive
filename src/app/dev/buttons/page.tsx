"use client";

import { useRef, useCallback } from "react";

/**
 * CTA Button Explorations — REFINED
 *
 * Monochromatic bands (asymmetric) + combos with:
 * jelly squish, pixel reveal, stacked cards, magnetic tilt,
 * pixel burst, color ripple
 */

const ELEPHANT_COLORS = [
  "#E74C3C", "#E67E22", "#F1C40F", "#2ECC71",
  "#1ABC9C", "#3498DB", "#8E44AD", "#2C5FA8",
];

function Section({
  title,
  description,
  children,
  dark,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className={`text-sm font-semibold ${dark ? "text-stone-200" : "text-stone-900"}`}>
          {title}
        </h3>
        {description && (
          <p className={`text-xs mt-0.5 max-w-lg ${dark ? "text-stone-400" : "text-stone-500"}`}>
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-5">{children}</div>
    </div>
  );
}

/* ─── Pixel Burst on Click ─── */
function usePixelBurst() {
  const containerRef = useRef<HTMLButtonElement>(null);
  const burst = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = containerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (let i = 0; i < 16; i++) {
      const pixel = document.createElement("div");
      const size = 3 + Math.random() * 5;
      const color = ELEPHANT_COLORS[Math.floor(Math.random() * ELEPHANT_COLORS.length)];
      const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.5;
      const distance = 30 + Math.random() * 50;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      Object.assign(pixel.style, {
        position: "absolute", left: `${x}px`, top: `${y}px`,
        width: `${size}px`, height: `${size}px`, background: color,
        borderRadius: "1px", pointerEvents: "none", zIndex: "50",
        transition: "all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)", opacity: "1",
      });
      btn.appendChild(pixel);
      requestAnimationFrame(() => {
        pixel.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.random() * 360}deg)`;
        pixel.style.opacity = "0";
      });
      setTimeout(() => pixel.remove(), 600);
    }
  }, []);
  return { containerRef, burst };
}

export default function ButtonExplorationsPage() {
  const burstA = usePixelBurst();
  const burstB = usePixelBurst();
  const burstC = usePixelBurst();
  const burstD = usePixelBurst();

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-5xl mx-auto px-8 py-12 space-y-14">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900">
            CTA Buttons — Refined Study
          </h1>
          <p className="text-sm text-stone-500 max-w-lg">
            Asymmetric monochromatic bands + interaction combos.
          </p>
        </div>

        <style>{`
          /* ════════════════════════════════
             ASYMMETRIC BAND TILES
             Inspired by the reference image:
             each tile has 3 bands of DIFFERENT heights
             ════════════════════════════════ */

          .tile-btn {
            position: relative;
            overflow: hidden;
            border-radius: 6px;
            transition: all 0.25s ease;
            box-shadow: 0 2px 0 rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.1);
          }
          .tile-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 0 rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.15);
          }
          .tile-btn:active {
            transform: translateY(1px);
            box-shadow: 0 1px 0 rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1);
          }

          /* ── Study A: Top-heavy (45/30/25) ── */
          .band-blue-a {
            background: linear-gradient(180deg,
              #3B82F6 0%, #3B82F6 45%,
              #2563EB 45%, #2563EB 75%,
              #1D4ED8 75%, #1D4ED8 100%
            );
          }
          .band-red-a {
            background: linear-gradient(180deg,
              #EF4444 0%, #EF4444 45%,
              #DC2626 45%, #DC2626 75%,
              #B91C1C 75%, #B91C1C 100%
            );
          }
          .band-navy-a {
            background: linear-gradient(180deg,
              #334155 0%, #334155 45%,
              #1E293B 45%, #1E293B 75%,
              #0F172A 75%, #0F172A 100%
            );
          }
          .band-cyan-a {
            background: linear-gradient(180deg,
              #22D3EE 0%, #22D3EE 45%,
              #06B6D4 45%, #06B6D4 75%,
              #0891B2 75%, #0891B2 100%
            );
          }
          .band-orange-a {
            background: linear-gradient(180deg,
              #FB923C 0%, #FB923C 45%,
              #F97316 45%, #F97316 75%,
              #EA580C 75%, #EA580C 100%
            );
          }
          .band-emerald-a {
            background: linear-gradient(180deg,
              #34D399 0%, #34D399 45%,
              #10B981 45%, #10B981 75%,
              #059669 75%, #059669 100%
            );
          }
          .band-gold-a {
            background: linear-gradient(180deg,
              #FBBF24 0%, #FBBF24 45%,
              #F59E0B 45%, #F59E0B 75%,
              #D97706 75%, #D97706 100%
            );
          }
          .band-coral-a {
            background: linear-gradient(180deg,
              #FB7185 0%, #FB7185 45%,
              #F43F5E 45%, #F43F5E 75%,
              #E11D48 75%, #E11D48 100%
            );
          }
          .band-violet-a {
            background: linear-gradient(180deg,
              #A78BFA 0%, #A78BFA 45%,
              #8B5CF6 45%, #8B5CF6 75%,
              #7C3AED 75%, #7C3AED 100%
            );
          }

          /* ── Study B: Bottom-heavy (25/30/45) ── */
          .band-blue-b {
            background: linear-gradient(180deg,
              #60A5FA 0%, #60A5FA 25%,
              #3B82F6 25%, #3B82F6 55%,
              #1D4ED8 55%, #1D4ED8 100%
            );
          }
          .band-red-b {
            background: linear-gradient(180deg,
              #FCA5A5 0%, #FCA5A5 25%,
              #EF4444 25%, #EF4444 55%,
              #B91C1C 55%, #B91C1C 100%
            );
          }
          .band-emerald-b {
            background: linear-gradient(180deg,
              #6EE7B7 0%, #6EE7B7 25%,
              #10B981 25%, #10B981 55%,
              #047857 55%, #047857 100%
            );
          }
          .band-orange-b {
            background: linear-gradient(180deg,
              #FDBA74 0%, #FDBA74 25%,
              #F97316 25%, #F97316 55%,
              #C2410C 55%, #C2410C 100%
            );
          }
          .band-coral-b {
            background: linear-gradient(180deg,
              #FDA4AF 0%, #FDA4AF 25%,
              #F43F5E 25%, #F43F5E 55%,
              #BE123C 55%, #BE123C 100%
            );
          }
          .band-gold-b {
            background: linear-gradient(180deg,
              #FDE68A 0%, #FDE68A 25%,
              #F59E0B 25%, #F59E0B 55%,
              #B45309 55%, #B45309 100%
            );
          }

          /* ── Study C: Thick bottom slab (20/25/55) — closest to reference ── */
          .band-blue-c {
            background: linear-gradient(180deg,
              #60A5FA 0%, #60A5FA 20%,
              #3B82F6 20%, #3B82F6 45%,
              #1E40AF 45%, #1E40AF 100%
            );
          }
          .band-red-c {
            background: linear-gradient(180deg,
              #FCA5A5 0%, #FCA5A5 20%,
              #EF4444 20%, #EF4444 45%,
              #991B1B 45%, #991B1B 100%
            );
          }
          .band-navy-c {
            background: linear-gradient(180deg,
              #475569 0%, #475569 20%,
              #1E293B 20%, #1E293B 45%,
              #020617 45%, #020617 100%
            );
          }
          .band-emerald-c {
            background: linear-gradient(180deg,
              #6EE7B7 0%, #6EE7B7 20%,
              #10B981 20%, #10B981 45%,
              #065F46 45%, #065F46 100%
            );
          }
          .band-orange-c {
            background: linear-gradient(180deg,
              #FDBA74 0%, #FDBA74 20%,
              #F97316 20%, #F97316 45%,
              #9A3412 45%, #9A3412 100%
            );
          }
          .band-gold-c {
            background: linear-gradient(180deg,
              #FDE68A 0%, #FDE68A 20%,
              #F59E0B 20%, #F59E0B 45%,
              #92400E 45%, #92400E 100%
            );
          }

          /* ── Study D: Top-heavy slab (55/15/30) ── */
          .band-blue-d {
            background: linear-gradient(180deg,
              #60A5FA 0%, #60A5FA 55%,
              #3B82F6 55%, #3B82F6 70%,
              #1E40AF 70%, #1E40AF 100%
            );
          }
          .band-red-d {
            background: linear-gradient(180deg,
              #FCA5A5 0%, #FCA5A5 55%,
              #EF4444 55%, #EF4444 70%,
              #991B1B 70%, #991B1B 100%
            );
          }
          .band-navy-d {
            background: linear-gradient(180deg,
              #475569 0%, #475569 55%,
              #1E293B 55%, #1E293B 70%,
              #020617 70%, #020617 100%
            );
          }
          .band-emerald-d {
            background: linear-gradient(180deg,
              #6EE7B7 0%, #6EE7B7 55%,
              #10B981 55%, #10B981 70%,
              #065F46 70%, #065F46 100%
            );
          }
          .band-orange-d {
            background: linear-gradient(180deg,
              #FDBA74 0%, #FDBA74 55%,
              #F97316 55%, #F97316 70%,
              #9A3412 70%, #9A3412 100%
            );
          }
          .band-gold-d {
            background: linear-gradient(180deg,
              #FDE68A 0%, #FDE68A 55%,
              #F59E0B 55%, #F59E0B 70%,
              #92400E 70%, #92400E 100%
            );
          }

          /* ═══ JELLY SQUISH ═══ */
          @keyframes squish {
            0% { transform: scale(1, 1); }
            30% { transform: scale(1.08, 0.88); }
            50% { transform: scale(0.96, 1.04); }
            70% { transform: scale(1.02, 0.98); }
            100% { transform: scale(1, 1); }
          }
          .jelly:active {
            animation: squish 0.4s ease;
          }

          /* ═══ BAND REVEAL (for pixel reveal) ═══ */
          @keyframes band-slide-1 {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(0); }
          }
          @keyframes band-slide-2 {
            0% { transform: translateX(100%); }
            100% { transform: translateX(0); }
          }
          @keyframes band-slide-3 {
            0% { transform: translateY(100%); }
            100% { transform: translateY(0); }
          }
          .reveal-btn {
            position: relative;
            overflow: hidden;
            transition: background 0.1s ease;
          }
          .reveal-btn .band {
            position: absolute;
            left: 0; right: 0;
            opacity: 0;
            transition: opacity 0.1s ease;
          }
          .reveal-btn .band-1 { top: 0; height: 45%; }
          .reveal-btn .band-2 { top: 45%; height: 30%; }
          .reveal-btn .band-3 { top: 75%; height: 25%; }

          .reveal-btn:hover .band {
            opacity: 1;
          }
          .reveal-btn:hover .band-1 {
            animation: band-slide-1 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) both;
          }
          .reveal-btn:hover .band-2 {
            animation: band-slide-2 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) 0.08s both;
          }
          .reveal-btn:hover .band-3 {
            animation: band-slide-3 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) 0.16s both;
          }
          .reveal-btn:not(:hover) .band {
            opacity: 0;
            animation: none;
          }

          /* ═══ STACKED CARDS ═══ */
          .stack-wrap {
            position: relative;
            display: inline-flex;
          }
          .stack-wrap .card-shadow {
            position: absolute;
            inset: 0;
            border-radius: 6px;
            transition: transform 0.3s ease;
          }
          .stack-wrap .shadow-1 { transform: translate(5px, 5px); }
          .stack-wrap .shadow-2 { transform: translate(2.5px, 2.5px); }
          .stack-wrap:hover .shadow-1 { transform: translate(7px, 7px); }
          .stack-wrap:hover .shadow-2 { transform: translate(3.5px, 3.5px); }
          .stack-wrap .top-btn {
            position: relative;
            z-index: 2;
            transition: transform 0.3s ease;
          }
          .stack-wrap:hover .top-btn {
            transform: translate(-1px, -1px);
          }

          /* ═══ MAGNETIC TILT ═══ */
          .magnetic {
            transition: box-shadow 0.15s ease;
          }

          /* ═══ COLOR RIPPLE ═══ */
          .btn-ripple { position: relative; overflow: hidden; }
          .btn-ripple .ripple-circle {
            position: absolute; border-radius: 50%;
            transform: scale(0); pointer-events: none;
            animation: ripple-grow 0.6s ease-out forwards;
          }
          @keyframes ripple-grow {
            to { transform: scale(4); opacity: 0; }
          }
        `}</style>

        {/* ════════════════════════════════════
            BAND PROPORTION STUDIES
            ════════════════════════════════════ */}
        <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
          Band Proportions
        </p>

        <Section
          title="Study A: Top-heavy (45 / 30 / 25)"
          description="Largest band on top, tapers down — like the bright face of each tile"
        >
          {[
            ["band-blue-a", "Blue"], ["band-red-a", "Red"], ["band-navy-a", "Navy"],
            ["band-cyan-a", "Cyan"], ["band-orange-a", "Orange"], ["band-emerald-a", "Emerald"],
          ].map(([cls, label]) => (
            <button key={cls} className={`tile-btn ${cls} inline-flex items-center justify-center h-11 px-6 text-[13px] font-semibold tracking-[0.12em] uppercase text-white`}>
              {label}
            </button>
          ))}
        </Section>

        <Section
          title="Study B: Bottom-heavy (25 / 30 / 45)"
          description="Light cap, medium mid, thick dark base — grounded, weighty"
        >
          {[
            ["band-blue-b", "Blue"], ["band-red-b", "Red"], ["band-emerald-b", "Emerald"],
            ["band-orange-b", "Orange"], ["band-coral-b", "Coral"], ["band-gold-b", "Gold"],
          ].map(([cls, label]) => (
            <button key={cls} className={`tile-btn ${cls} inline-flex items-center justify-center h-11 px-6 text-[13px] font-semibold tracking-[0.12em] uppercase text-white`}>
              {label}
            </button>
          ))}
        </Section>

        <Section
          title="Study C: Thick slab (20 / 25 / 55) — closest to reference"
          description="Thin light cap, narrow mid stripe, big dark slab — most like the icon tiles"
        >
          {[
            ["band-blue-c", "Blue"], ["band-red-c", "Red"], ["band-navy-c", "Navy"],
            ["band-emerald-c", "Emerald"], ["band-orange-c", "Orange"], ["band-gold-c", "Gold"],
          ].map(([cls, label]) => (
            <button key={cls} className={`tile-btn ${cls} inline-flex items-center justify-center h-11 px-6 text-[13px] font-semibold tracking-[0.12em] uppercase text-white`}>
              {label}
            </button>
          ))}
        </Section>

        <Section
          title="Study D: Top-heavy slab (55 / 15 / 30)"
          description="Big bright face, thin mid stripe, medium dark base — matches reference image ratio"
        >
          {[
            ["band-blue-d", "Blue"], ["band-red-d", "Red"], ["band-navy-d", "Navy"],
            ["band-emerald-d", "Emerald"], ["band-orange-d", "Orange"], ["band-gold-d", "Gold"],
          ].map(([cls, label]) => (
            <button key={cls} className={`tile-btn ${cls} inline-flex items-center justify-center h-11 px-6 text-[13px] font-semibold tracking-[0.12em] uppercase text-white`}>
              {label}
            </button>
          ))}
        </Section>

        {/* Large CTAs — proportion comparison */}
        <Section title="Large CTA — Study C (20/25/55)" description="">
          <button className="tile-btn band-blue-c inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
          <button className="tile-btn band-emerald-c inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
          <button className="tile-btn band-orange-c inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
        </Section>

        <Section title="Large CTA — Study D (55/15/30)" description="">
          <button className="tile-btn band-blue-d inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
          <button className="tile-btn band-emerald-d inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
          <button className="tile-btn band-orange-d inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
        </Section>

        <hr className="border-stone-200" />

        {/* ════════════════════════════════════
            INTERACTION COMBOS
            ════════════════════════════════════ */}
        <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
          Interaction Combos
        </p>

        {/* Monochromatic + Jelly Squish */}
        <Section
          title="Bands + Jelly Squish"
          description="Click and it squishes — the satisfying tactile feel paired with the tile aesthetic"
        >
          <button className="tile-btn band-blue-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Event
          </button>
          <button className="tile-btn band-red-c jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
            Get Started
          </button>
          <button className="tile-btn band-emerald-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Publish Gallery
          </button>
        </Section>

        {/* Monochromatic + Pixel Reveal */}
        <Section
          title="Bands Reveal on Hover"
          description="Solid mid-tone at rest — bands slide in on hover revealing the depth. Try hovering on and off!"
        >
          <button className="reveal-btn tile-btn inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white rounded-md" style={{ background: "#3B82F6" }}>
            <span className="band band-1" style={{ background: "#60A5FA" }} />
            <span className="band band-2" style={{ background: "#3B82F6" }} />
            <span className="band band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="reveal-btn tile-btn inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md" style={{ background: "#EF4444" }}>
            <span className="band band-1" style={{ background: "#FCA5A5" }} />
            <span className="band band-2" style={{ background: "#EF4444" }} />
            <span className="band band-3" style={{ background: "#991B1B" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="reveal-btn tile-btn inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md" style={{ background: "#10B981" }}>
            <span className="band band-1" style={{ background: "#6EE7B7" }} />
            <span className="band band-2" style={{ background: "#10B981" }} />
            <span className="band band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Publish Gallery</span>
          </button>
        </Section>

        {/* Monochromatic + Stacked Cards */}
        <Section
          title="Bands + Stacked Cards"
          description="The tile button floats on colored card shadows — depth like stacked photos"
        >
          <span className="stack-wrap">
            <span className="card-shadow shadow-1 band-coral-a" style={{ opacity: 0.5 }} />
            <span className="card-shadow shadow-2 band-gold-a" style={{ opacity: 0.7 }} />
            <button className="top-btn tile-btn band-blue-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
              Create Event
            </button>
          </span>
          <span className="stack-wrap" style={{ marginLeft: "16px" }}>
            <span className="card-shadow shadow-1 band-blue-a" style={{ opacity: 0.5 }} />
            <span className="card-shadow shadow-2 band-orange-a" style={{ opacity: 0.7 }} />
            <button className="top-btn tile-btn band-emerald-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
              Publish Gallery
            </button>
          </span>
        </Section>

        {/* Monochromatic + Magnetic Tilt */}
        <Section
          title="Bands + Magnetic Tilt"
          description="Hover slowly — the tile button tilts toward your cursor in 3D"
        >
          <button
            className="tile-btn band-blue-c magnetic inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white"
            onMouseMove={(e) => {
              const btn = e.currentTarget;
              const rect = btn.getBoundingClientRect();
              const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
              const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
              btn.style.transform = `perspective(500px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-2px)`;
              btn.style.boxShadow = `${-x * 8}px ${y * 8 + 4}px 20px rgba(0,0,0,0.2)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "";
            }}
          >
            Create Your First Event
          </button>
          <button
            className="tile-btn band-emerald-c magnetic inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white"
            onMouseMove={(e) => {
              const btn = e.currentTarget;
              const rect = btn.getBoundingClientRect();
              const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
              const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
              btn.style.transform = `perspective(500px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-2px)`;
              btn.style.boxShadow = `${-x * 8}px ${y * 8 + 4}px 20px rgba(0,0,0,0.2)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "";
            }}
          >
            Get Started
          </button>
        </Section>

        <hr className="border-stone-200" />

        {/* ════════════════════════════════════
            CLICK EFFECTS ON MONOCHROMATIC
            ════════════════════════════════════ */}
        <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
          Click Effects (click these!)
        </p>

        {/* Pixel Burst */}
        <Section
          title="Bands + Pixel Burst"
          description="Mosaic confetti on click — for celebration moments (Publish, Create, etc.)"
        >
          <button
            ref={burstA.containerRef}
            onClick={burstA.burst}
            className="tile-btn band-blue-c jelly relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white overflow-visible"
          >
            Create Event
          </button>
          <button
            ref={burstB.containerRef}
            onClick={burstB.burst}
            className="tile-btn band-emerald-c jelly relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white overflow-visible"
          >
            Publish Gallery
          </button>
        </Section>

        {/* Color Ripple */}
        <Section
          title="Bands + Color Ripple"
          description="Random elephant color ripple on each click — subtle, surprising"
        >
          <button
            className="btn-ripple tile-btn band-navy-c inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white"
            onClick={(e) => {
              const btn = e.currentTarget;
              const rect = btn.getBoundingClientRect();
              const circle = document.createElement("span");
              const size = Math.max(rect.width, rect.height);
              const color = ELEPHANT_COLORS[Math.floor(Math.random() * ELEPHANT_COLORS.length)];
              Object.assign(circle.style, {
                width: `${size}px`, height: `${size}px`,
                left: `${e.clientX - rect.left - size / 2}px`,
                top: `${e.clientY - rect.top - size / 2}px`,
                background: color, opacity: "0.35",
              });
              circle.className = "ripple-circle";
              btn.appendChild(circle);
              setTimeout(() => circle.remove(), 700);
            }}
          >
            Click Repeatedly
          </button>
        </Section>

        <hr className="border-stone-200" />

        {/* ════════════════════════════════════
            MY RECOMMENDATION
            ════════════════════════════════════ */}
        <div className="bg-stone-100 border border-stone-200 -mx-8 px-8 py-10 rounded-lg space-y-6">
          <div>
            <p className="text-xs font-medium tracking-wider uppercase text-emerald-600">
              Recommended combo
            </p>
            <h3 className="text-sm font-semibold text-stone-900 mt-1">
              Study C Bands + Jelly Squish (always) + Pixel Burst (celebrations only)
            </h3>
            <p className="text-xs text-stone-500 mt-1 max-w-lg">
              Every button press: satisfying jelly squish. Key moments (Create Event, Publish, Share):
              pixel burst confetti. The bands give brand identity, jelly gives tactile delight,
              burst gives celebration. None of it gets old because the big effect is reserved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {/* Regular button — just jelly */}
            <button className="tile-btn band-blue-c jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
              Save Draft
            </button>
            <button className="tile-btn band-blue-c jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
              Get Started
            </button>
            {/* Celebration button — jelly + burst */}
            <button
              ref={burstC.containerRef}
              onClick={burstC.burst}
              className="tile-btn band-emerald-c jelly relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white overflow-visible"
            >
              Publish Gallery
            </button>
            <button
              ref={burstD.containerRef}
              onClick={burstD.burst}
              className="tile-btn band-orange-c jelly relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white overflow-visible"
            >
              Create Event
            </button>
          </div>
        </div>

        <hr className="border-stone-200" />

        {/* ════════════════════════════════════
            SOLID → BANDS ON HOVER
            ════════════════════════════════════ */}
        <style>{`
          /* Base: solid mid-tone color. Hover: bands cascade in */
          .solid-to-bands {
            position: relative;
            overflow: hidden;
            border-radius: 6px;
            transition: all 0.25s ease;
            box-shadow: 0 2px 0 rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.1);
          }
          .solid-to-bands:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 0 rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.15);
          }
          .solid-to-bands:active {
            transform: translateY(1px);
            box-shadow: 0 1px 0 rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1);
          }
          .solid-to-bands .s-band {
            position: absolute;
            left: 0; right: 0;
            transform: scaleY(0);
            transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
          }
          /* Default (Study C: 20/25/55) */
          .solid-to-bands .s-band-1 { top: 0; height: 20%; transform-origin: top; }
          .solid-to-bands .s-band-2 { top: 20%; height: 25%; transform-origin: top; }
          .solid-to-bands .s-band-3 { bottom: 0; height: 55%; transform-origin: bottom; }

          /* Study A proportions: 45/30/25 */
          .solid-to-bands.prop-a .s-band-1 { height: 45%; }
          .solid-to-bands.prop-a .s-band-2 { top: 45%; height: 30%; }
          .solid-to-bands.prop-a .s-band-3 { height: 25%; }

          /* Study B proportions: 25/30/45 */
          .solid-to-bands.prop-b .s-band-1 { height: 25%; }
          .solid-to-bands.prop-b .s-band-2 { top: 25%; height: 30%; }
          .solid-to-bands.prop-b .s-band-3 { height: 45%; }

          /* Study D proportions: 55/15/30 */
          .solid-to-bands.prop-d .s-band-1 { height: 55%; }
          .solid-to-bands.prop-d .s-band-2 { top: 55%; height: 15%; }
          .solid-to-bands.prop-d .s-band-3 { height: 30%; }

          /* V1: Cascade — bands unfurl top-to-bottom like a curtain */
          .cascade:hover .s-band-1 {
            transform: scaleY(1);
            transition-delay: 0s;
          }
          .cascade:hover .s-band-2 {
            transform: scaleY(1);
            transition-delay: 0.06s;
          }
          .cascade:hover .s-band-3 {
            transform: scaleY(1);
            transition-delay: 0.12s;
          }

          /* V2: Slam — all bands scale in simultaneously but from different origins */
          .slam .s-band-1 { transform-origin: left; transform: scaleX(0); }
          .slam .s-band-2 { transform-origin: right; transform: scaleX(0); }
          .slam .s-band-3 { transform-origin: left; transform: scaleX(0); }
          .slam:hover .s-band-1 {
            transform: scaleX(1);
            transition-delay: 0s;
          }
          .slam:hover .s-band-2 {
            transform: scaleX(1);
            transition-delay: 0.05s;
          }
          .slam:hover .s-band-3 {
            transform: scaleX(1);
            transition-delay: 0.1s;
          }

          /* V3: Iris — bands expand from center outward */
          .iris .s-band-1 { transform-origin: center; transform: scaleY(0); }
          .iris .s-band-2 { transform-origin: center; transform: scaleY(0); }
          .iris .s-band-3 { transform-origin: center; transform: scaleY(0); }
          .iris:hover .s-band-1 {
            transform: scaleY(1);
            transition-delay: 0.08s;
          }
          .iris:hover .s-band-2 {
            transform: scaleY(1);
            transition-delay: 0s;
          }
          .iris:hover .s-band-3 {
            transform: scaleY(1);
            transition-delay: 0.08s;
          }

          /* V4: Wipe — single direction sweep left to right */
          .wipe .s-band { transform-origin: left; transform: scaleX(0); }
          .wipe:hover .s-band {
            transform: scaleX(1);
          }
          .wipe:hover .s-band-1 { transition-delay: 0s; }
          .wipe:hover .s-band-2 { transition-delay: 0s; }
          .wipe:hover .s-band-3 { transition-delay: 0s; }

          /* V5: Slide — bands fly in from different directions (like original reveal) */
          .slide .s-band { transform: none; opacity: 0; transition: transform 0.35s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.15s ease; }
          .slide .s-band-1 { transform: translateX(-100%); }
          .slide .s-band-2 { transform: translateX(100%); }
          .slide .s-band-3 { transform: translateY(100%); }
          .slide:hover .s-band { opacity: 1; transform: translate(0, 0); }
          .slide:hover .s-band-1 { transition-delay: 0s; }
          .slide:hover .s-band-2 { transition-delay: 0.08s; }
          .slide:hover .s-band-3 { transition-delay: 0.16s; }

          /* V6: Cross Slide — top from right, bottom from left (middle matches bg so we skip it visually) */
          .cross-slide .s-band { transform: none; opacity: 0; transition: transform 0.23s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.1s ease; }
          .cross-slide .s-band-1 { transform: translateX(100%); }
          .cross-slide .s-band-2 { transform: scaleY(0); transition: transform 0.17s ease; }
          .cross-slide .s-band-3 { transform: translateX(-100%); }
          .cross-slide:hover .s-band { opacity: 1; }
          .cross-slide:hover .s-band-1 { transform: translateX(0); transition-delay: 0s; }
          .cross-slide:hover .s-band-2 { transform: scaleY(1); transition-delay: 0.04s; }
          .cross-slide:hover .s-band-3 { transform: translateX(0); transition-delay: 0.07s; }
        `}</style>
        <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
          Solid → Bands on Hover
        </p>

        <Section
          title="V1. Cascade — bands unfurl top to bottom"
          description="Solid blue at rest, bands drop in like a curtain on hover"
        >
          <button className="solid-to-bands cascade glow-blue jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="solid-to-bands cascade glow-emerald jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands cascade glow-orange jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#F97316" }}>
            <span className="s-band s-band-1" style={{ background: "#FDBA74" }} />
            <span className="s-band s-band-2" style={{ background: "#F97316" }} />
            <span className="s-band s-band-3" style={{ background: "#9A3412" }} />
            <span className="relative z-10">Share Gallery</span>
          </button>
        </Section>

        <Section
          title="V2. Slam — bands slide in from alternating sides"
          description="Each band wipes in from a different direction — left, right, left"
        >
          <button className="solid-to-bands slam jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="solid-to-bands slam jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#EF4444" }}>
            <span className="s-band s-band-1" style={{ background: "#FCA5A5" }} />
            <span className="s-band s-band-2" style={{ background: "#EF4444" }} />
            <span className="s-band s-band-3" style={{ background: "#991B1B" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands slam jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Publish Gallery</span>
          </button>
        </Section>

        <Section
          title="V3. Iris — Study A (45/30/25)"
          description="Top-heavy — big bright face"
        >
          <button className="solid-to-bands prop-a iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-a iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-a iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#F97316" }}>
            <span className="s-band s-band-1" style={{ background: "#FDBA74" }} />
            <span className="s-band s-band-2" style={{ background: "#F97316" }} />
            <span className="s-band s-band-3" style={{ background: "#9A3412" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
        </Section>

        <Section
          title="V3. Iris — Study B (25/30/45)"
          description="Bottom-heavy — grounded, weighty"
        >
          <button className="solid-to-bands prop-b iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-b iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-b iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#F97316" }}>
            <span className="s-band s-band-1" style={{ background: "#FDBA74" }} />
            <span className="s-band s-band-2" style={{ background: "#F97316" }} />
            <span className="s-band s-band-3" style={{ background: "#9A3412" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
        </Section>

        <Section
          title="V3. Iris — Study C (20/25/55)"
          description="Thick dark slab — original default, closest to icon"
        >
          <button className="solid-to-bands iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#F97316" }}>
            <span className="s-band s-band-1" style={{ background: "#FDBA74" }} />
            <span className="s-band s-band-2" style={{ background: "#F97316" }} />
            <span className="s-band s-band-3" style={{ background: "#9A3412" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
        </Section>

        <Section
          title="V3. Iris — Study D (55/15/30)"
          description="Big bright face, thin mid stripe, medium dark base — from reference image"
        >
          <button className="solid-to-bands prop-d iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-d iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands prop-d iris jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#F97316" }}>
            <span className="s-band s-band-1" style={{ background: "#FDBA74" }} />
            <span className="s-band s-band-2" style={{ background: "#F97316" }} />
            <span className="s-band s-band-3" style={{ background: "#9A3412" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
        </Section>

        <Section
          title="V4. Wipe — clean single-direction sweep"
          description="All bands wipe in from left simultaneously — simple, clean, satisfying"
        >
          <button className="solid-to-bands wipe jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="solid-to-bands wipe jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands wipe jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#1E293B" }}>
            <span className="s-band s-band-1" style={{ background: "#475569" }} />
            <span className="s-band s-band-2" style={{ background: "#1E293B" }} />
            <span className="s-band s-band-3" style={{ background: "#020617" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
        </Section>

        <Section
          title="V5. Slide — bands fly in from different directions"
          description="Top from left, middle from right, bottom from below — like the original reveal but on a solid color base"
        >
          <button className="solid-to-bands slide jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="solid-to-bands slide jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands slide jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#EF4444" }}>
            <span className="s-band s-band-1" style={{ background: "#FCA5A5" }} />
            <span className="s-band s-band-2" style={{ background: "#EF4444" }} />
            <span className="s-band s-band-3" style={{ background: "#991B1B" }} />
            <span className="relative z-10">Share Gallery</span>
          </button>
        </Section>

        <Section
          title="V6. Cross Slide — top from right, bottom from left"
          description="Bands cross paths — top slides in from right, bottom from left. The mid band subtly scales in."
        >
          <button className="solid-to-bands cross-slide jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white" style={{ background: "#3B82F6" }}>
            <span className="s-band s-band-1" style={{ background: "#60A5FA" }} />
            <span className="s-band s-band-2" style={{ background: "#3B82F6" }} />
            <span className="s-band s-band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Get Started</span>
          </button>
          <button className="solid-to-bands cross-slide jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#10B981" }}>
            <span className="s-band s-band-1" style={{ background: "#6EE7B7" }} />
            <span className="s-band s-band-2" style={{ background: "#10B981" }} />
            <span className="s-band s-band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button className="solid-to-bands cross-slide jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white" style={{ background: "#EF4444" }}>
            <span className="s-band s-band-1" style={{ background: "#FCA5A5" }} />
            <span className="s-band s-band-2" style={{ background: "#EF4444" }} />
            <span className="s-band s-band-3" style={{ background: "#991B1B" }} />
            <span className="relative z-10">Share Gallery</span>
          </button>
        </Section>

        <hr className="border-stone-200" />

        {/* ════════════════════════════════════
            CLEVER COMBOS
            ════════════════════════════════════ */}
        <style>{`
          /* Colored shadow that matches the button's dominant band */
          .glow-blue { box-shadow: 0 2px 0 rgba(30,64,175,0.5), 0 8px 24px rgba(59,130,246,0.25); }
          .glow-blue:hover { box-shadow: 0 4px 0 rgba(30,64,175,0.4), 0 12px 32px rgba(59,130,246,0.35); }
          .glow-emerald { box-shadow: 0 2px 0 rgba(6,95,70,0.5), 0 8px 24px rgba(16,185,129,0.25); }
          .glow-emerald:hover { box-shadow: 0 4px 0 rgba(6,95,70,0.4), 0 12px 32px rgba(16,185,129,0.35); }
          .glow-orange { box-shadow: 0 2px 0 rgba(154,52,18,0.5), 0 8px 24px rgba(249,115,22,0.25); }
          .glow-orange:hover { box-shadow: 0 4px 0 rgba(154,52,18,0.4), 0 12px 32px rgba(249,115,22,0.35); }

          /* Subtle breathe animation — very gentle scale pulse */
          @keyframes breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.015); }
          }
          .breathe { animation: breathe 3s ease-in-out infinite; }
          .breathe:hover { animation: none; }

          /* Band reveal + jelly combo */
          .reveal-jelly:active { animation: squish 0.4s ease; }
        `}</style>
        <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
          Clever Combos
        </p>

        <Section
          title="CC1. Bands + Color-Matched Glow"
          description="The drop shadow takes on the button's color — buttons feel like they're glowing with their own light"
        >
          <button className="tile-btn band-blue-c glow-blue jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Event
          </button>
          <button className="tile-btn band-emerald-c glow-emerald jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Publish Gallery
          </button>
          <button className="tile-btn band-orange-c glow-orange jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
            Share Link
          </button>
        </Section>

        <Section
          title="CC2. Band Reveal → Jelly → Pixel Burst (the full journey)"
          description="Solid at rest → bands slide in on hover → squishes on click → confetti on celebration. The button tells a story."
        >
          <button
            ref={burstA.containerRef}
            onClick={burstA.burst}
            className="reveal-btn reveal-jelly tile-btn relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md overflow-visible"
            style={{ background: "#3B82F6" }}
          >
            <span className="band band-1" style={{ background: "#60A5FA" }} />
            <span className="band band-2" style={{ background: "#3B82F6" }} />
            <span className="band band-3" style={{ background: "#1E40AF" }} />
            <span className="relative z-10">Create Your First Event</span>
          </button>
          <button
            ref={burstB.containerRef}
            onClick={burstB.burst}
            className="reveal-btn reveal-jelly tile-btn relative inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md overflow-visible"
            style={{ background: "#10B981" }}
          >
            <span className="band band-1" style={{ background: "#6EE7B7" }} />
            <span className="band band-2" style={{ background: "#10B981" }} />
            <span className="band band-3" style={{ background: "#065F46" }} />
            <span className="relative z-10">Publish Gallery</span>
          </button>
        </Section>

        <Section
          title="CC3. Bands + Gentle Breathe"
          description="A very subtle scale pulse — the button feels alive, like it's waiting for you. Stops on hover so it doesn't fight your interaction."
        >
          <button className="tile-btn band-blue-c breathe jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
            Create Your First Event
          </button>
          <button className="tile-btn band-emerald-c breathe jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
            Get Started
          </button>
        </Section>

        <Section
          title="CC4. Stacked Cards + Band Reveal"
          description="Dark button on colored card shadows — hover reveals the bands on the top card. Photos-in-a-stack energy."
        >
          <span className="stack-wrap">
            <span className="card-shadow shadow-1" style={{ background: "#F43F5E", opacity: 0.4, borderRadius: 6 }} />
            <span className="card-shadow shadow-2" style={{ background: "#F59E0B", opacity: 0.6, borderRadius: 6 }} />
            <button className="top-btn reveal-btn tile-btn jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md" style={{ background: "#3B82F6" }}>
              <span className="band band-1" style={{ background: "#60A5FA" }} />
              <span className="band band-2" style={{ background: "#3B82F6" }} />
              <span className="band band-3" style={{ background: "#1E40AF" }} />
              <span className="relative z-10">Create Event</span>
            </button>
          </span>
        </Section>

        <Section
          title="CC5. Magnetic Tilt + Color Glow"
          description="Tilt follows your cursor + the glow shifts direction to match — feels like holding a holographic card"
        >
          <button
            className="tile-btn band-blue-c magnetic jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white"
            onMouseMove={(e) => {
              const btn = e.currentTarget;
              const rect = btn.getBoundingClientRect();
              const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
              const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
              btn.style.transform = `perspective(500px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-2px)`;
              btn.style.boxShadow = `${-x * 12}px ${y * 12 + 6}px 28px rgba(59,130,246,0.35)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "";
            }}
          >
            Create Your First Event
          </button>
        </Section>

        <hr className="border-stone-200" />

        {/* ──────── DARK BACKGROUND ──────── */}
        <div className="bg-stone-900 -mx-8 px-8 py-12 space-y-8 rounded-lg">
          <p className="text-xs font-medium tracking-wider uppercase text-stone-400">
            On dark backgrounds
          </p>

          <Section title="Study C — Blue, Emerald, Orange" description="" dark>
            <button className="tile-btn band-blue-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
              Create Event
            </button>
            <button className="tile-btn band-emerald-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
              Publish Gallery
            </button>
            <button className="tile-btn band-orange-c jelly inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white">
              Share Link
            </button>
          </Section>

          <Section title="Study C — Coral, Gold, Navy" description="" dark>
            <button className="tile-btn band-coral-b jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
              Coral
            </button>
            <button className="tile-btn band-gold-c jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
              Gold
            </button>
            <button className="tile-btn band-navy-c jelly inline-flex items-center justify-center h-11 px-8 text-[13px] font-semibold tracking-[0.12em] uppercase text-white">
              Navy
            </button>
          </Section>

          <Section title="Band Reveal (hover)" description="" dark>
            <button className="reveal-btn tile-btn inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md" style={{ background: "#3B82F6" }}>
              <span className="band band-1" style={{ background: "#60A5FA" }} />
              <span className="band band-2" style={{ background: "#3B82F6" }} />
              <span className="band band-3" style={{ background: "#1E40AF" }} />
              <span className="relative z-10">Create Event</span>
            </button>
            <button className="reveal-btn tile-btn inline-flex items-center justify-center h-12 px-10 text-[13px] font-semibold tracking-[0.15em] uppercase text-white rounded-md" style={{ background: "#10B981" }}>
              <span className="band band-1" style={{ background: "#6EE7B7" }} />
              <span className="band band-2" style={{ background: "#10B981" }} />
              <span className="band band-3" style={{ background: "#065F46" }} />
              <span className="relative z-10">Publish Gallery</span>
            </button>
          </Section>
        </div>

        <div className="text-xs text-stone-400 pb-8">
          Dev-only at <code className="text-stone-500">/dev/buttons</code>
        </div>
      </div>
    </div>
  );
}
