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
  /**
   * For `slot` scenes: the page auto-rotates through EVERY image in drag
   * order (first image opens). The API returns the full set instead of just
   * the winner, and the editor hint says so. Slot semantics otherwise apply
   * (focal-point suggestions, art-directed crops).
   */
  rotates?: boolean;
  /**
   * Site-relative path of the page that renders this scene (e.g.
   * "/services/video"). The editor links to it so the team can see the
   * imagery in place — see sceneUrl().
   */
  path: string;
  /**
   * One-line editor hint: where on the page the images appear and how many
   * the page actually shows. Rendered under the section title in the TDP
   * Website gallery. Mechanics (order/count rules) come from kind/positions
   * via sceneUsageHint() — keep this about PLACE, not mechanics.
   */
  description: string;
}

/**
 * Registry order = section order in the website gallery (sections.sort_order).
 */
export const SITE_SCENES: SceneDef[] = [
  // ── Pools (rotating grids) ──────────────────────────────────────────────
  { key: "hero", label: "Hero Pool", kind: "pool", path: "/",
    description: "Homepage hero mosaic — flips through the whole pool" },
  { key: "featured-work", label: "Featured Work", kind: "pool", path: "/",
    description: "Homepage Featured Work — fallback only; jobs (TDP Work) lead when any exist" },
  { key: "backgrounds", label: "Backgrounds", kind: "pool", path: "/",
    description: "Reserved — not rendered by any page yet" },
  { key: "service/photo-booth", label: "Photo Booth", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "Party Booth picker card + Party section mini-gallery on the Photo Booth page" },
  { key: "photo-booth/overhead", label: "Photo Booth — Overhead", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "Overhead detail mini-gallery (shows 4; hidden until 3+ images)" },
  { key: "photo-booth/bw-glam", label: "Photo Booth — B&W Glam", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "B&W Glam detail mini-gallery (shows 4; hidden until 3+ images)" },
  { key: "photo-booth/custom-sets", label: "Photo Booth — Custom Sets", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "Custom Sets detail mini-gallery (shows 4; hidden until 3+ images)" },
  { key: "photo-booth/step-and-repeat", label: "Photo Booth — Step & Repeat", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "Step & Repeat detail mini-gallery (shows 4; hidden until 3+ images)" },
  { key: "ai-examples", label: "AI Examples", kind: "pool", path: "/services/headshot-booth",
    description: "AI strip on the Headshot Booth + Photo Booth pages (shows 4; hidden until 3+ images)" },
  { key: "service/anti-booth", label: "Anti-Booth", kind: "pool", service: "anti-booth", path: "/services/photo-booth",
    description: "Anti-Booth card on the Photo Booth page’s booth picker" },
  { key: "service/video", label: "Video", kind: "pool", service: "video", path: "/services/video",
    description: "“Watch the work” reel grid — every video here, 16:9, drag order, plays in place" },
  { key: "service/environmental-portraits", label: "Environmental Portraits", kind: "pool", service: "environmental-portraits", path: "/services/office-headshots",
    description: "Environmental-portraits detail gallery on Office Headshots (shows 4; hidden until 3+ images)" },
  { key: "bts/headshot-booth", label: "BTS — Headshot Booth", kind: "pool", service: "headshot-booth", path: "/services/headshot-booth",
    description: "“What it looks like” BTS mosaic (up to 6 tiles; hidden until 3+ images)" },
  { key: "bts/photo-booth", label: "BTS — Photo Booth", kind: "pool", service: "photo-booth", path: "/services/photo-booth",
    description: "“What it looks like” BTS mosaic (up to 6 tiles; hidden until 3+ images)" },
  { key: "bts/anti-booth", label: "BTS — Anti-Booth", kind: "pool", service: "anti-booth", path: "/services/anti-booth",
    description: "“What it looks like” BTS mosaic (up to 6 tiles; hidden until 3+ images)" },
  { key: "drop-in/actors", label: "Drop-In — Actors", kind: "pool", service: "drop-in-sessions", path: "/services/drop-in-sessions",
    description: "Actor + theatrical mini-gallery on the Drop-In page (hidden until 3+ images)" },

  // ── Slots: homepage angled services row (one image each) ────────────────
  { key: "slot/slice-1", label: "Slice 01 — Headshot Booth", kind: "slot", rotates: true, service: "headshot-booth", path: "/",
    description: "Homepage “What we do” card — Headshot Booth" },
  { key: "slot/slice-2", label: "Slice 02 — Photo Booth", kind: "slot", rotates: true, service: "photo-booth", path: "/",
    description: "Homepage “What we do” card — Photo Booth" },
  { key: "slot/slice-3", label: "Slice 03 — Anti-Booth", kind: "slot", rotates: true, service: "anti-booth", path: "/",
    description: "Homepage “What we do” card — Anti-Booth" },
  { key: "slot/slice-4", label: "Slice 04 — Event Photography", kind: "slot", rotates: true, service: "event-photography", path: "/",
    description: "Homepage “What we do” card — Event Photography" },
  { key: "slot/slice-5", label: "Slice 05 — Video", kind: "slot", rotates: true, service: "video", path: "/",
    description: "Homepage “What we do” card — Video" },
  // The site's sixth "What we do" card is Office Headshots (Services.tsx) —
  // the old Environmental Portraits label predated that rename. Existing
  // section names in the DB are unaffected; this fixes the service auto-fill.
  { key: "slot/slice-6", label: "Slice 06 — Office Headshots", kind: "slot", rotates: true, service: "office-headshots", path: "/",
    description: "Homepage “What we do” card — Office Headshots" },

  // ── Slots: service-page heroes (auto-rotating carousels, drag order) ─────
  { key: "slot/hero/headshot-booth", label: "Hero — Headshot Booth", kind: "slot", rotates: true, service: "headshot-booth", path: "/services/headshot-booth",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/photo-booth", label: "Hero — Photo Booth", kind: "slot", rotates: true, service: "photo-booth", path: "/services/photo-booth",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/anti-booth", label: "Hero — Anti-Booth", kind: "slot", rotates: true, service: "anti-booth", path: "/services/anti-booth",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/event-photography", label: "Hero — Event Photography", kind: "slot", rotates: true, service: "event-photography", path: "/services/event-photography",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/video", label: "Hero — Video", kind: "slot", rotates: true, service: "video", path: "/services/video",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/environmental-portraits", label: "Hero — Environmental Portraits", kind: "slot", rotates: true, service: "environmental-portraits", path: "/services/office-headshots",
    description: "Hero carousel for the environmental-portraits section" },
  { key: "slot/hero/office-headshots", label: "Hero — Office Headshots", kind: "slot", rotates: true, service: "office-headshots", path: "/services/office-headshots",
    description: "Service-page hero carousel at the top of the page" },
  { key: "slot/hero/drop-in-sessions", label: "Hero — Drop-In Sessions", kind: "slot", rotates: true, service: "drop-in-sessions", path: "/services/drop-in-sessions",
    description: "Service-page hero carousel at the top of the page" },

  // ── Slot: social link-preview image (Open Graph) ─────────────────────────
  { key: "slot/og", label: "OG / Link Preview", kind: "slot", path: "/",
    description: "Social link-preview (OG) image for every page — cropped 1.91:1 around the focal point" },

  // ── Ordered: position-mapped page sets (image N → position N) ────────────
  { key: "benefits/headshot-booth", label: "Benefits — Headshot Booth", kind: "ordered", service: "headshot-booth", positions: 6, path: "/services/headshot-booth",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/photo-booth", label: "Benefits — Photo Booth", kind: "ordered", service: "photo-booth", positions: 6, path: "/services/photo-booth",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/anti-booth", label: "Benefits — Anti-Booth", kind: "ordered", service: "anti-booth", positions: 6, path: "/services/anti-booth",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/event-photography", label: "Benefits — Event Photography", kind: "ordered", service: "event-photography", positions: 6, path: "/services/event-photography",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/video", label: "Benefits — Video", kind: "ordered", service: "video", positions: 6, path: "/services/video",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/office-headshots", label: "Benefits — Office Headshots", kind: "ordered", service: "office-headshots", positions: 6, path: "/services/office-headshots",
    description: "Benefits grid — image N fills tile N" },
  { key: "benefits/drop-in-sessions", label: "Benefits — Drop-In Sessions", kind: "ordered", service: "drop-in-sessions", positions: 6, path: "/services/drop-in-sessions",
    description: "Benefits grid — image N fills tile N" },
  { key: "story", label: "Story / Crew", kind: "ordered", positions: 3, path: "/about",
    description: "Crew story stack — homepage and About page (3 overlapping photos)" },
  { key: "about-values", label: "About — Values", kind: "ordered", positions: 4, path: "/about",
    description: "Values tiles on the About page (4 photo-led tiles)" },
  { key: "quote", label: "Quote Page", kind: "ordered", positions: 2, path: "/quote",
    description: "Quote page — image 1 is the main photo, image 2 the inset" },
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

/**
 * One-line mechanics hint for the editor: how many images the scene uses and
 * whether drag order matters. Derived from kind/positions so it can never
 * drift from the actual API behavior.
 */
export function sceneUsageHint(scene: SceneDef): string {
  if (scene.kind === "slot") {
    return scene.rotates
      ? "Rotates through every image, in drag order"
      : "Single image — first by drag order wins";
  }
  if (scene.kind === "ordered") {
    return `First ${scene.positions} images, exact drag order`;
  }
  return "Rotating pool — featured first";
}

/** Absolute URL of the page this scene renders on (live marketing site). */
export function sceneUrl(scene: SceneDef): string {
  const base = (
    process.env.NEXT_PUBLIC_MARKETING_URL || "https://twodudesphoto.com"
  ).replace(/\/$/, "");
  return `${base}${scene.path}`;
}
