/**
 * Which `events.settings` keys a CLIENT may write.
 *
 * The events POST/PATCH routes merge whatever `settings` object the request
 * carries. That is fine for the photographer's own preferences (sharing,
 * cover, recap, mosaic) and wrong for the few keys that mean "this gallery is
 * part of the Two Dudes website": any account could set `work: true` on its
 * own event and have its photos published to TDP's Featured Work (pilot
 * audit, 2026-11-14). Those keys are set only by server code
 * (`getWebsiteSection`, a hand-run setup for TDP Work), so a client write
 * keeps whatever the event already holds.
 *
 * The site lanes no longer trust these flags alone either: they identify the
 * Work and Website galleries by their globally unique, server-generated slug.
 * This guard is the second layer, so a flag on a tenant's event means nothing
 * and cannot be put there.
 */
export const SERVER_OWNED_SETTINGS_KEYS = ["work", "website"] as const;

type Settings = Record<string, unknown>;

function isPlainObject(v: unknown): v is Settings {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A client's settings object for a NEW event, minus every server-owned key. */
export function clientSettingsForCreate(incoming: unknown): Settings | undefined {
  if (!isPlainObject(incoming)) return undefined;
  const out: Settings = { ...incoming };
  for (const key of SERVER_OWNED_SETTINGS_KEYS) delete out[key];
  return out;
}

/**
 * Shallow-merge a client's settings over the stored ones, with every
 * server-owned key held at its stored value (absent stays absent).
 */
export function mergeClientSettings(current: Settings, incoming: unknown): Settings {
  const merged: Settings = { ...current, ...(isPlainObject(incoming) ? incoming : {}) };
  for (const key of SERVER_OWNED_SETTINGS_KEYS) {
    if (key in current) merged[key] = current[key];
    else delete merged[key];
  }
  return merged;
}
