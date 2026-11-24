"use client";

import { useMemo } from "react";
import { FillJob, type FillApi, type Job, type Photo } from "@/components/fill/FillJob";

/**
 * /dev/fill — the crew pick page rendered from a fixture, so its phone layout
 * can be checked in any browser with no sign-in (the real page needs the
 * owner's session, and the app refuses to be framed). Two sources with long
 * names, one photo already in the job, a few already on the site, a short
 * delay on every call so loading states show. Nothing here touches the API.
 */

const tones = ["#d6d3d1", "#a8a29e", "#e7e5e4", "#78716c", "#cbd5e1", "#e2e8f0"];

function portrait(i: number): string {
  const bg = tones[i % tones.length];
  const suit = ["#1c1917", "#292524", "#1e3a8a", "#44403c"][i % 4];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 500'><rect width='400' height='500' fill='${bg}'/><circle cx='200' cy='190' r='78' fill='#f5d0b5'/><path d='M60 500c10-120 70-170 140-170s130 50 140 170z' fill='${suit}'/><text x='16' y='484' font-family='sans-serif' font-size='28' fill='#fff'>${i + 1}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function photo(sourceIdx: number, i: number): Photo {
  const url = portrait(i + sourceIdx * 7);
  return { id: `s${sourceIdx}-${i}`, thumbnailUrl: url, thumbnailLgUrl: url, onSite: i % 11 === 4 };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DevFillPage() {
  const api = useMemo<FillApi>(() => {
    const job: Job = {
      sectionId: "dev",
      name: "World Employer Branding Week 2024",
      workEventId: "dev",
      locked: false,
      missing: ["event size"],
      memberIds: ["s0-2"],
      sources: [
        { eventId: "a", name: "World Employer Branding Week // Headshots", photoCount: 1301 },
        { eventId: "b", name: "Great Place to Work // Event Photos", photoCount: 324 },
      ],
    };
    const idx = (id: string) => (id === "a" ? 0 : 1);
    return {
      job: async () => {
        await wait(300);
        return { ...job, memberIds: [...job.memberIds] };
      },
      shortlist: async (sourceId) => {
        await wait(1200);
        return Array.from({ length: 36 }, (_, i) => photo(idx(sourceId), i));
      },
      photos: async (sourceId, offset) => {
        await wait(500);
        const total = job.sources[idx(sourceId)].photoCount;
        const n = Math.max(0, Math.min(60, total - offset));
        return {
          photos: Array.from({ length: n }, (_, i) => photo(idx(sourceId), offset + i)),
          nextOffset: offset + n < total ? offset + n : null,
        };
      },
      add: async (ids) => {
        await wait(600);
        job.memberIds.push(...ids);
      },
    };
  }, []);
  return <FillJob api={api} />;
}
