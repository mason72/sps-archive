/**
 * Website scene registry (v2 — gallery-based).
 *
 * A "scene" is a named content slot on the Two Dudes Photo marketing site. In
 * the v2 model each scene is backed by a SECTION of the dedicated "TDP Website"
 * gallery (sections.site_scene_key = the scene key) — membership in that
 * section IS publication. Open the gallery and you see the entire site's
 * imagery organized by where it appears; no per-image tags to backtrace.
 *
 * Three kinds of scene:
 *  - pool: a rotating grid — the site picks a subset (featured-first) on its own
 *  - ordered: a position-mapped set — the site assigns image N to position N,
 *    so the API returns EXACT drag order (no featured boost, no rotation);
 *    `positions` says how many the page uses (extras are ignored)
 *  - slot: an explicit single-image position — the FIRST image by the section's
 *    drag order (section_images.sort_order) wins; extras are ignored
 *
 * The site reads scenes via GET /api/site/scene/[key]. Adding a scene is a
 * one-line change here (keep in sync with the website's src/lib/scenes.ts);
 * the section is scaffolded automatically — no migration required.
 */

export type SceneKind = "pool" | "ordered" | "slot";

export interface SceneDef {
  /** Stable key stored in sections.site_scene_key and used in the API path. */
  key: string;
  /** Human label — also the scaffolded section's name in the website gallery. */
  label: string;
  /** Rotating grid (pool), position-mapped set (ordered), or single image (slot). */
  kind: SceneKind;
  /**
   * Service this scene implies, if any. Used to auto-fill images.service when
   * an image is added (never overwriting a manual value) and as the read-time
   * fallback for the API's `service` caption field.
   */
  service?: string;
  /**
   * For `ordered` scenes: how many positions the page maps (drag position 1
   * fills position 1, …). Drives the editor's "extras are ignored" hint.
   */
  positions?: number;
}

/**
 * Registry order = section order in the website gallery (sections.sort_order).
 */
export const SITE_SCENES: SceneDef[] = [
  // ── Pools (rotating grids) ──────────────────────────────────────────────
  { key: "hero", label: "Hero Pool", kind: "pool" },
  { key: "featured-work", label: "Featured Work", kind: "pool" },
  { key: "backgrounds", label: "Backgrounds", kind: "pool" },
  { key: "service/headshot-booth", label: "Headshot Booth", kind: "pool", service: "headshot-booth" },
  { key: "service/photo-booth", label: "Photo Booth", kind: "pool", service: "photo-booth" },
  { key: "photo-booth/overhead", label: "Photo Booth — Overhead", kind: "pool", service: "photo-booth" },
  { key: "photo-booth/bw-glam", label: "Photo Booth — B&W Glam", kind: "pool", service: "photo-booth" },
  { key: "photo-booth/custom-sets", label: "Photo Booth — Custom Sets", kind: "pool", service: "photo-booth" },
  { key: "service/anti-booth", label: "Anti-Booth", kind: "pool", service: "anti-booth" },
  { key: "service/event-photography", label: "Event Photography", kind: "pool", service: "event-photography" },
  { key: "service/video", label: "Video", kind: "pool", service: "video" },
  { key: "service/environmental-portraits", label: "Environmental Portraits", kind: "pool", service: "environmental-portraits" },
  { key: "service/office-headshots", label: "Office Headshots", kind: "pool", service: "office-headshots" },
  { key: "service/drop-in-sessions", label: "Drop-In Sessions", kind: "pool", service: "drop-in-sessions" },

  // ── Slots: homepage angled services row (one image each) ────────────────
  { key: "slot/slice-1", label: "Slice 01 — Headshot Booth", kind: "slot", service: "headshot-booth" },
  { key: "slot/slice-2", label: "Slice 02 — Photo Booth", kind: "slot", service: "photo-booth" },
  { key: "slot/slice-3", label: "Slice 03 — Anti-Booth", kind: "slot", service: "anti-booth" },
  { key: "slot/slice-4", label: "Slice 04 — Event Photography", kind: "slot", service: "event-photography" },
  { key: "slot/slice-5", label: "Slice 05 — Video", kind: "slot", service: "video" },
  { key: "slot/slice-6", label: "Slice 06 — Environmental Portraits", kind: "slot", service: "environmental-portraits" },

  // ── Slots: service-page heroes (one image each) ──────────────────────────
  { key: "slot/hero/headshot-booth", label: "Hero — Headshot Booth", kind: "slot", service: "headshot-booth" },
  { key: "slot/hero/photo-booth", label: "Hero — Photo Booth", kind: "slot", service: "photo-booth" },
  { key: "slot/hero/anti-booth", label: "Hero — Anti-Booth", kind: "slot", service: "anti-booth" },
  { key: "slot/hero/event-photography", label: "Hero — Event Photography", kind: "slot", service: "event-photography" },
  { key: "slot/hero/video", label: "Hero — Video", kind: "slot", service: "video" },
  { key: "slot/hero/environmental-portraits", label: "Hero — Environmental Portraits", kind: "slot", service: "environmental-portraits" },
  { key: "slot/hero/office-headshots", label: "Hero — Office Headshots", kind: "slot", service: "office-headshots" },
  { key: "slot/hero/drop-in-sessions", label: "Hero — Drop-In Sessions", kind: "slot", service: "drop-in-sessions" },

  // ── Ordered: position-mapped page sets (image N → position N) ────────────
  { key: "benefits/headshot-booth", label: "Benefits — Headshot Booth", kind: "ordered", service: "headshot-booth", positions: 6 },
  { key: "benefits/photo-booth", label: "Benefits — Photo Booth", kind: "ordered", service: "photo-booth", positions: 6 },
  { key: "benefits/anti-booth", label: "Benefits — Anti-Booth", kind: "ordered", service: "anti-booth", positions: 6 },
  { key: "benefits/event-photography", label: "Benefits — Event Photography", kind: "ordered", service: "event-photography", positions: 6 },
  { key: "benefits/video", label: "Benefits — Video", kind: "ordered", service: "video", positions: 6 },
  { key: "benefits/office-headshots", label: "Benefits — Office Headshots", kind: "ordered", service: "office-headshots", positions: 6 },
  { key: "benefits/drop-in-sessions", label: "Benefits — Drop-In Sessions", kind: "ordered", service: "drop-in-sessions", positions: 6 },
  { key: "story", label: "Story / Crew", kind: "ordered", positions: 3 },
  { key: "about-values", label: "About — Values", kind: "ordered", positions: 4 },
  { key: "quote", label: "Quote Page", kind: "ordered", positions: 2 },
];

const SCENES_BY_KEY = new Map(SITE_SCENES.map((s) => [s.key, s]));

/**
 * Canonical service slugs, in registry order — the only valid values for
 * images.service. The curation editor's service dropdown and the images PATCH
 * validation both read this list, so a new service added to the registry is
 * immediately editable everywhere.
 */
export const SITE_SERVICES: string[] = [
  ...new Set(
    SITE_SCENES.map((s) => s.service).filter((s): s is string => Boolean(s))
  ),
];

/** Is this a known scene key? */
export function isValidScene(key: string): boolean {
  return SCENES_BY_KEY.has(key);
}

/** The registry entry for a scene key, or undefined. */
export function sceneForKey(key: string): SceneDef | undefined {
  return SCENES_BY_KEY.get(key);
}

/** Is this scene an explicit single-image slot (vs a rotating pool)? */
export function isSlotScene(key: string): boolean {
  return SCENES_BY_KEY.get(key)?.kind === "slot";
}

/**
 * The service implied by a scene key, or null. Scenes without an implied
 * service (hero, featured-work, backgrounds) return null — the team can still
 * set images.service manually if they want it surfaced on the site.
 */
export function deriveServiceFromScene(key: string): string | null {
  return SCENES_BY_KEY.get(key)?.service ?? null;
}
