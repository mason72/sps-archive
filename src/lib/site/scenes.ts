/**
 * Website scene registry.
 *
 * A "scene" is a named slot on the Two Dudes Photo marketing site that pulls
 * curated, rotating imagery from Pixeltrunk. The team tags images into a scene
 * inside the app; the site reads them via GET /api/site/scene/[key].
 *
 * Keep this list in sync with the website's expectations. Adding a scene here is
 * the only change needed to support a new slot — no migration required, because
 * site_scene is a free-text column validated against this registry in app code.
 */

export interface SceneDef {
  /** Stable key stored in images.site_scene and used in the API path. */
  key: string;
  /** Human label for the admin scene picker. */
  label: string;
  /**
   * Service this scene implies, if any. When a `service/*` scene is applied we
   * auto-fill images.service from this so the team doesn't double-enter it.
   */
  service?: string;
}

export const SITE_SCENES: SceneDef[] = [
  { key: "hero", label: "Hero" },
  { key: "featured-work", label: "Featured Work" },
  { key: "backgrounds", label: "Backgrounds" },
  { key: "service/headshot-booth", label: "Headshot Booth", service: "headshot-booth" },
  { key: "service/photo-booth", label: "Photo Booth", service: "photo-booth" },
  { key: "service/anti-booth", label: "Anti-Booth", service: "anti-booth" },
  { key: "service/event-photography", label: "Event Photography", service: "event-photography" },
  { key: "service/video", label: "Video", service: "video" },
  { key: "service/environmental-portraits", label: "Environmental Portraits", service: "environmental-portraits" },
];

const SCENE_KEYS = new Set(SITE_SCENES.map((s) => s.key));

/** Is this a known scene key? */
export function isValidScene(key: string): boolean {
  return SCENE_KEYS.has(key);
}

/**
 * The service implied by a scene key, or null.
 *
 * `service/photo-booth` → "photo-booth". Non-service scenes (hero,
 * featured-work, backgrounds) imply no service — the team can still set one
 * manually if they want it surfaced on the site.
 */
export function deriveServiceFromScene(key: string): string | null {
  return SITE_SCENES.find((s) => s.key === key)?.service ?? null;
}
