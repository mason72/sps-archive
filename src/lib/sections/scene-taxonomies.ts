/**
 * Scene taxonomies for intelligent sections (Phase 4 of the AI revival).
 *
 * Labels are classified at SUGGEST TIME against stored SigLIP-2 embeddings —
 * nothing is persisted at ingest, so editing these lists costs nothing (no
 * GPU re-runs). Prompts are phrased like captions; that's what the model
 * ranks best. Section order here is the narrative order sections appear in.
 *
 * The photographer picks the taxonomy in the sort modal (defaulted from
 * event_type) — no guessing which kind of event this is.
 */

export interface SceneLabel {
  /** Section name as it will appear in the gallery. */
  name: string;
  /** Caption-style prompt handed to the text encoder. */
  prompt: string;
}

export interface SceneTaxonomy {
  key: string;
  label: string;
  scenes: SceneLabel[];
}

export const SCENE_TAXONOMIES: SceneTaxonomy[] = [
  {
    key: "wedding",
    label: "Wedding",
    scenes: [
      { name: "Getting Ready", prompt: "a photo of the bride or groom getting ready before a wedding, hair and makeup, dressing" },
      { name: "Ceremony", prompt: "a photo of a wedding ceremony, vows at the altar, exchanging rings, officiant" },
      { name: "Portraits", prompt: "a posed portrait photo of the couple or wedding party" },
      { name: "Reception", prompt: "a photo of a wedding reception, guests at dinner tables, venue with table settings" },
      { name: "Speeches & Toasts", prompt: "a photo of a person giving a toast or speech with a microphone or raised glass" },
      { name: "Dancing", prompt: "a photo of people dancing at a party, dance floor" },
      { name: "Cake & Desserts", prompt: "a photo of a wedding cake or dessert table or cutting the cake" },
      { name: "Details & Decor", prompt: "a close-up photo of wedding details, rings, flowers, invitations, decorations" },
    ],
  },
  {
    key: "corporate",
    label: "Corporate event",
    scenes: [
      { name: "Speakers & Presentations", prompt: "a photo of a person presenting on stage or a slide presentation to an audience" },
      { name: "Panels", prompt: "a photo of a panel discussion with several seated speakers" },
      { name: "Networking & Candids", prompt: "a candid photo of people talking and mingling at a professional event" },
      { name: "Group Photos", prompt: "a posed photo of a large group of people together" },
      { name: "Venue & Details", prompt: "a photo of an event venue, signage, stage design, or branded details" },
      { name: "Food & Drink", prompt: "a photo of catering, food, or drinks at an event" },
    ],
  },
  {
    key: "party",
    label: "Party",
    scenes: [
      { name: "Photo Booth", prompt: "a photo of people posing at a photo booth with props" },
      { name: "Dancing", prompt: "a photo of people dancing at a party, dance floor" },
      { name: "Candids", prompt: "a candid photo of people laughing and celebrating" },
      { name: "Group Photos", prompt: "a posed photo of a group of friends together" },
      { name: "Details & Decor", prompt: "a photo of party decorations, venue details, or table settings" },
    ],
  },
  {
    key: "general",
    label: "General",
    scenes: [
      { name: "Portraits", prompt: "a posed portrait photo of one person" },
      { name: "Group Photos", prompt: "a posed photo of a group of people together" },
      { name: "Candids", prompt: "a candid photo of people interacting naturally" },
      { name: "Details", prompt: "a close-up photo of objects or details, no people" },
      { name: "Venue & Spaces", prompt: "a wide photo of a venue, room, or outdoor space" },
    ],
  },
];

/** Default taxonomy for an event_type; the modal lets the photographer switch. */
export function defaultTaxonomyKey(eventType: string | null): string {
  switch ((eventType ?? "").toLowerCase()) {
    case "corporate":
      return "corporate";
    case "wedding":
      return "wedding";
    default:
      return "general";
  }
}

export function taxonomyByKey(key: string): SceneTaxonomy | undefined {
  return SCENE_TAXONOMIES.find((t) => t.key === key);
}
