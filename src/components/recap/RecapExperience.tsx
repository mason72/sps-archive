"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PasswordGate } from "@/components/gallery/PasswordGate";
import { ElephantWalk } from "@/components/brand/ElephantWalk";
import type { RecapPayload, RecapBrand, RecapLeadFrame } from "@/lib/recap/payload";
import { formatCount, formatSeconds, recapOpenRate } from "@/lib/recap/normalize";
import { buildHourChart, timingBars } from "@/lib/recap/chart";
import type { SpsRecap } from "@/lib/recap/types";
import { dateRange } from "@/lib/recap/dates";

/**
 * The recap page. Reads /api/recap/[slug] and renders the story of one
 * event's delivery: who was photographed, what they received, how fast, with
 * the photographer's brand and the client's logo. Motion is decoration on top
 * of a page that is complete at rest: every number renders at its final value
 * on first paint, the curve is drawn in full for anyone who prefers reduced
 * motion, and nothing waits for a scroll to exist.
 */

type Locked = { requiresPassword: true; eventName: string; customMessage: string | null; photographer: RecapBrand };
type State =
  | { kind: "loading" }
  | { kind: "locked"; data: Locked }
  | { kind: "gone"; message: string }
  | { kind: "ready"; data: RecapPayload };

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** True once the element has been on screen; never goes back to false. */
function useInView<T extends Element>(threshold = 0.2): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setSeen(true)),
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** Counts from 0 to `target` once `active`; renders the target at rest. */
function useCountUp(target: number, active: boolean, reduced: boolean, ms = 1500): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!active || reduced || target <= 0) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduced, ms]);
  return value;
}

/**
 * Parallax by transform only. Each layer drifts by `factor` of its distance
 * from the viewport center, so layers at different factors separate as the
 * page scrolls. No layout is touched, and reduced motion pins everything.
 */
function useParallax(reduced: boolean) {
  const layers = useRef<Map<HTMLElement, number>>(new Map());
  const register = useCallback(
    (factor: number) => (el: HTMLElement | null) => {
      if (el) layers.current.set(el, factor);
    },
    []
  );
  useEffect(() => {
    if (reduced) {
      layers.current.forEach((_, el) => (el.style.transform = ""));
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      layers.current.forEach((factor, el) => {
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2 - vh / 2;
        el.style.transform = `translate3d(0, ${(-center * factor).toFixed(1)}px, 0)`;
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);
  return register;
}

const EYEBROW = "text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500";

function Lockup({ photographer, clientLogoUrl, clientName, dark = false }: {
  photographer: RecapBrand;
  clientLogoUrl: string | null;
  clientName: string | null;
  dark?: boolean;
}) {
  const nameCls = dark ? "text-stone-50" : "text-stone-900";
  return (
    <div className="flex items-center gap-4">
      {clientLogoUrl ? (
        <img src={clientLogoUrl} alt={clientName ?? "Client"} className="h-7 w-auto max-w-[140px] object-contain" />
      ) : clientName ? (
        <span className={`font-editorial text-lg ${nameCls}`}>{clientName}</span>
      ) : null}
      {(clientLogoUrl || clientName) && <span className="text-stone-400">×</span>}
      {photographer.logoUrl ? (
        <img src={photographer.logoUrl} alt={photographer.businessName ?? "Photographer"} className="h-7 w-auto max-w-[140px] object-contain" />
      ) : (
        <span className={`font-editorial text-lg ${nameCls}`}>{photographer.businessName ?? "Your photographer"}</span>
      )}
    </div>
  );
}

function Mosaic({ leads, register }: { leads: RecapLeadFrame[]; register: (f: number) => (el: HTMLElement | null) => void }) {
  if (leads.length === 0) return null;
  const cols = [leads.filter((_, i) => i % 2 === 0), leads.filter((_, i) => i % 2 === 1)];
  const factors = [0.06, -0.05];
  return (
    <div className="grid w-full max-w-[50vh] grid-cols-2 gap-3 md:ml-auto md:gap-4" aria-hidden="true">
      {cols.map((col, ci) => (
        <div key={ci} ref={register(factors[ci])} className={`flex flex-col gap-3 md:gap-4 will-change-transform ${ci === 1 ? "pt-10" : ""}`}>
          {/* Two per column: with the 50vh width cap, two rows of 2:3 frames
              are about 75vh, so the hero fits one screen on a tablet. */}
          {col.slice(0, 2).map((f, i) => (
            <img
              key={f.id}
              src={f.url}
              alt=""
              className="reveal w-full rounded-[3px] object-cover shadow-sm"
              style={{
                aspectRatio: "2 / 3",
                objectPosition: `${f.focalX ?? 50}% ${f.focalY ?? 35}%`,
                animationDelay: `${(ci * 4 + i) * 70}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function AiStrip({ leads }: { leads: RecapLeadFrame[] }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return (
    <div ref={ref} className="grid grid-cols-4 gap-2 sm:gap-3 md:grid-cols-8">
      {leads.map((f, i) => (
        <img
          key={f.id}
          src={f.url}
          alt=""
          className={`w-full rounded-[3px] object-cover ${seen ? "reveal" : "opacity-0"}`}
          style={{ aspectRatio: "2 / 3", objectPosition: `${f.focalX ?? 50}% ${f.focalY ?? 35}%`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-editorial text-4xl tracking-tight text-stone-900 tabular-nums md:text-5xl">{value}</div>
      <div className="mt-2 text-sm text-stone-600">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

function HourCurve({ recap, reduced }: { recap: SpsRecap; reduced: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const chart = buildHourChart(recap, 680, 220);
  const drawn = seen || reduced;
  const peakLabel = chart.peak
    ? `${chart.peak.sent} in one hour`
    : null;
  const openedPath = (points: typeof chart.days[number]["points"]) =>
    points
      .map((p, i) => {
        const y = chart.baseline - (p.opened / chart.maxSent) * (chart.baseline - 26);
        return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <div ref={ref} className="min-w-0">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="w-full" role="img" aria-label="Galleries delivered per hour, sent and opened">
        <style>{`.rc-line{stroke-dasharray:1;stroke-dashoffset:${drawn ? 0 : 1};transition:stroke-dashoffset 1.8s cubic-bezier(.16,1,.3,1)}.rc-area{opacity:${drawn ? 1 : 0};transition:opacity 1.2s ease .4s}`}</style>
        {chart.areaPaths.map((d, i) => (
          <path key={`a${i}`} d={d} className="rc-area fill-stone-900/[0.06]" />
        ))}
        {chart.linePaths.map((d, i) => (
          <path key={`l${i}`} d={d} pathLength={1} className="rc-line fill-none stroke-stone-400" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {chart.days.map((d, i) => (
          <path key={`o${i}`} d={openedPath(d.points)} pathLength={1} className="rc-line fill-none stroke-stone-900" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ transitionDelay: "300ms" }} />
        ))}
        <line x1={0} x2={chart.width} y1={chart.baseline + 0.5} y2={chart.baseline + 0.5} className="stroke-stone-200" />
        {chart.days.map((d) => (
          <text key={d.date} x={d.x0} y={chart.baseline + 18} className="fill-stone-500 text-[11px]">{d.label}</text>
        ))}
        {chart.peak && drawn && (
          <g className="fade-in" style={{ animationDelay: "1.4s" }}>
            <circle cx={chart.peak.x} cy={chart.peak.y} r={4.5} className="fill-stone-400 stroke-white" strokeWidth={2} />
            <text x={chart.peak.x - 10} y={chart.peak.y - 10} textAnchor="end" className="fill-stone-900 text-[12px] font-medium">{peakLabel}</text>
          </g>
        )}
      </svg>
      <div className="mt-2 flex gap-5 text-xs text-stone-500">
        <span className="flex items-center gap-2"><i className="inline-block h-0.5 w-4 bg-stone-400" />sent</span>
        <span className="flex items-center gap-2"><i className="inline-block h-0.5 w-4 bg-stone-900" />opened</span>
      </div>
    </div>
  );
}

function TimingBars({ recap, reduced }: { recap: SpsRecap; reduced: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const bars = timingBars(recap);
  if (bars.length === 0) return null;
  const grown = seen || reduced;
  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-4">
      {bars.map((b, i) => (
        <div key={b.label} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="text-stone-600">{b.label}</span>
          <div className="h-3 overflow-hidden rounded-[2px] bg-stone-100">
            <div
              className={`h-full ${i === 0 ? "bg-stone-900" : i === 1 ? "bg-stone-500" : "bg-stone-300"}`}
              style={{ width: grown ? `${Math.max(1, b.share * 100).toFixed(1)}%` : "0%", transition: `width 1.1s cubic-bezier(.16,1,.3,1) ${i * 120}ms` }}
            />
          </div>
          <span className="text-right text-stone-900 tabular-nums">{Math.round(b.share * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function Cards({ slug, eventName }: { slug: string; eventName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const variants = [
    { id: "wide", label: "Wide", hint: "slides, LinkedIn", w: 1600, h: 840 },
    { id: "square", label: "Square", hint: "Slack, Instagram", w: 1080, h: 1080 },
  ];
  const copy = async (id: string) => {
    setFailed(null);
    try {
      const res = await fetch(`/api/recap/${slug}/card/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(id);
      setTimeout(() => setCopied(null), 2200);
    } catch {
      setFailed(id);
    }
  };
  const file = (id: string) => `${eventName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "recap"}-recap-${id}.png`;
  return (
    <div className="grid gap-8 md:grid-cols-[1.6fr_1fr] md:items-start">
      {variants.map((v) => (
        <div key={v.id} className="min-w-0">
          <img
            src={`/api/recap/${slug}/card/${v.id}`}
            alt={`${eventName} recap card, ${v.label.toLowerCase()}`}
            width={v.w}
            height={v.h}
            className="w-full rounded-[3px] shadow-md"
            style={{ aspectRatio: `${v.w} / ${v.h}` }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm text-stone-600">{v.label} <span className="text-stone-400">· {v.hint}</span></span>
            <a
              href={`/api/recap/${slug}/card/${v.id}`}
              download={file(v.id)}
              className="rounded-md border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50"
            >
              Download
            </a>
            <button
              type="button"
              onClick={() => copy(v.id)}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
            >
              {copied === v.id ? "Copied" : failed === v.id ? "Use Download" : "Copy image"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ eyebrow, title, children, lead }: { eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  const [ref, seen] = useInView<HTMLElement>(0.15);
  return (
    <section ref={ref} className={`grid gap-8 border-t border-stone-200 py-14 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] md:gap-14 ${seen ? "reveal" : ""}`}>
      <div>
        <div className={EYEBROW}>{eyebrow}</div>
        <h2 className="font-editorial mt-2 text-2xl leading-tight text-stone-900 md:text-[28px]" style={{ textWrap: "balance" }}>{title}</h2>
        {lead && <p className="mt-3 text-[15px] leading-relaxed text-stone-600">{lead}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Ready({ data }: { data: RecapPayload }) {
  const reduced = useReducedMotion();
  const register = useParallax(reduced);
  const [heroRef, heroSeen] = useInView<HTMLElement>(0.1);
  const r = data.recap;
  const leadNumber = r && r.guests > 0 ? r.guests : r?.photos || data.archive.photos;
  const shown = useCountUp(leadNumber, heroSeen, reduced);
  const median = r ? formatSeconds(r.lastFrameToSend.medianSec) : null;
  const open = r ? recapOpenRate(r) : null;
  const when = dateRange(r, data.eventDate);
  const perGuest = r && r.guests > 0 ? Math.round(data.archive.photos / r.guests) : null;
  const namedShare = data.archive.photos > 0 ? data.archive.named / data.archive.photos : 0;
  const leadsWith = r && r.guests > 0;

  return (
    <main className="min-h-screen bg-white text-stone-900">
      <div className="mx-auto max-w-[1180px] px-5 md:px-8">
        <header className="flex items-center justify-between py-5">
          <Lockup photographer={data.photographer} clientLogoUrl={data.clientLogoUrl} clientName={data.clientName} />
          <div className={`${EYEBROW} text-right`}>{data.eventName}<br className="md:hidden" /><span className="hidden md:inline"> · </span>Recap</div>
        </header>

        <section ref={heroRef} className="grid items-center gap-10 py-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:py-16">
          <div className="min-w-0">
            <div className={EYEBROW}>{when ?? data.eventName}</div>
            <div className="font-editorial mt-4 text-[clamp(84px,15vw,172px)] leading-[0.88] tracking-[-0.04em] text-stone-900 tabular-nums">
              {formatCount(shown)}
            </div>
            <h1 className="font-editorial mt-5 text-[clamp(22px,3vw,32px)] leading-[1.15] text-stone-900" style={{ textWrap: "balance" }}>
              {leadsWith
                ? "people walked away with a finished gallery."
                : "finished photos, delivered on site."}
            </h1>
            <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-stone-600">
              Every frame was lit, shot, culled and named on site. Nobody needed retouching.
              {median ? ` Guests had their gallery in hand ${median} after their last frame, median.` : ""}
            </p>
          </div>
          <Mosaic leads={data.leads} register={register} />
        </section>

        {r && (
          <section className="grid gap-8 border-y border-stone-200 py-8 sm:grid-cols-3">
            <Stat value={formatCount(data.archive.photos)} label="finished photos" sub={perGuest ? `about ${perGuest} per guest` : undefined} />
            {median ? <Stat value={median} label="median from last frame to inbox" sub={r.lastFrameToSend.p90Sec ? `9 in 10 within ${formatSeconds(r.lastFrameToSend.p90Sec)}` : undefined} /> : <Stat value={formatCount(r.linksSent)} label="galleries sent" />}
            {open !== null ? <Stat value={`${open}%`} label="of guests opened their gallery" sub={`${formatCount(r.totalOpens)} opens in all`} /> : <Stat value={formatCount(data.archive.named)} label="photos carrying a name" />}
          </section>
        )}

        {r && r.hours.length > 1 && (
          <Section
            eyebrow="Delivery"
            title={`How the ${new Set(r.hours.map((h) => h.startsAt.slice(0, 10))).size > 1 ? "days" : "day"} went`}
            lead="Galleries per hour. The lighter line is galleries sent; the darker one is how many of those were opened."
          >
            <HourCurve recap={r} reduced={reduced} />
          </Section>
        )}

        {r && timingBars(r).length > 0 && (
          <Section
            eyebrow="Speed"
            title="From the last frame to the inbox"
            lead={`Measured on ${formatCount(r.lastFrameToSend.measured)} galleries: the time between a guest's last photo and their gallery leaving for their inbox.`}
          >
            <TimingBars recap={r} reduced={reduced} />
          </Section>
        )}

        {data.aiLeads.length > 0 && (
          <Section
            eyebrow="AI looks"
            title="Every guest could try an AI look too."
            lead={`${formatCount(data.archive.aiRenders)} AI renders, made on the spot from each guest's own headshot and delivered in the same gallery.`}
          >
            <AiStrip leads={data.aiLeads} />
          </Section>
        )}

        <Section eyebrow="The product" title="What every guest received" lead="The standard shown on the website is the standard your attendees got.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="border border-stone-200 p-5">
              <div className="font-editorial text-lg text-stone-900">Finished, not raw</div>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{formatCount(data.archive.photos)} photos, lit so nobody needs retouching, culled on the spot. No blinks, no duplicates, no &ldquo;finals to follow.&rdquo;</p>
            </div>
            <div className="border border-stone-200 p-5">
              <div className="font-editorial text-lg text-stone-900">Named and searchable</div>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {namedShare >= 0.95
                  ? "Every photo carries the person's name, so a guest finds themselves in one search, in a year."
                  : `${Math.round(namedShare * 100)}% of photos carry the person's name, so a guest finds themselves by searching for it.`}
              </p>
            </div>
            <div className="border border-stone-200 p-5">
              <div className="font-editorial text-lg text-stone-900">Yours to keep</div>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">The full set lives in <a href={data.galleryUrl} className="underline underline-offset-2">your gallery</a>, branded to you and downloadable by anyone you give the link to.</p>
            </div>
          </div>
        </Section>

        {r && (
          <Section eyebrow="Share it" title="Paste-ready cards" lead="For a deck, a channel or a post-event report. Copy puts the image on your clipboard; Download saves the PNG.">
            <Cards slug={data.slug} eventName={data.eventName} />
          </Section>
        )}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 py-8">
          <Lockup photographer={data.photographer} clientLogoUrl={data.clientLogoUrl} clientName={data.clientName} />
          <div className="text-xs text-stone-500">
            {data.photographer.website ? (
              <a href={data.photographer.website} className="hover:text-stone-900">{data.photographer.website.replace(/^https?:\/\//, "")}</a>
            ) : null}
            {data.photographer.website ? " · " : ""}Recap by Pixeltrunk
          </div>
        </footer>
      </div>
    </main>
  );
}

export function RecapExperience({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/recap/${slug}`, { cache: "no-store" });
      if (res.status === 401) {
        setState({ kind: "locked", data: (await res.json()) as Locked });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "gone", message: body.error ?? "This recap is not available." });
        return;
      }
      setState({ kind: "ready", data: (await res.json()) as RecapPayload });
    } catch {
      setState({ kind: "gone", message: "Could not load the recap. Try again in a moment." });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <ElephantWalk message="Gathering the numbers" />
      </div>
    );
  }
  if (state.kind === "locked") {
    return (
      <PasswordGate
        slug={slug}
        eventName={state.data.eventName}
        customMessage={state.data.customMessage}
        onSuccess={() => void load()}
      />
    );
  }
  if (state.kind === "gone") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
        <div>
          <div className="font-editorial text-2xl text-stone-900">{state.message}</div>
          <p className="mt-2 text-sm text-stone-500">Ask the photographer for a fresh link.</p>
        </div>
      </div>
    );
  }
  return <Ready data={state.data} />;
}
