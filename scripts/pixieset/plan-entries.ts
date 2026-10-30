/**
 * Which photographs a Pixieset archive holds, and where each one belongs.
 *
 * Pure: no database, no R2, no disk. `pixieset-ingest.ts` and
 * `triage/px-filecheck.ts` both lean on it, and `plan-entries.test.ts` proves it
 * (`npx tsx --test scripts/pixieset/plan-entries.test.ts`).
 *
 * ── Identity is (filename, bytes), never the filename alone ──────────────────
 *
 * Until 2026-10-29 the ingest deduped every entry by BASENAME across all sets,
 * on the belief that Pixieset repeats one photo's bytes in each set it sits in.
 * True for Highlights-style subsets. False twice over:
 *   - rendition sets (BW / Color / With Logo, Retouched vs Lightboost) give each
 *     version the SAME name, so one version per name survived and the others
 *     never reached the archive (Ayesha's 30th: 1,747 files in, 582 kept);
 *   - camera counters repeat across days, so two different photos share a name
 *     (SPIE 2017's "Day 1" held 511 frames captured on Day 2).
 * 73,615 entries across 470 collections were merged that way; how many were
 * truly distinct is in memory `pixieset-same-name-collapse`.
 *
 * Bytes are identified by the CRC-32 and size the ZIP's central directory
 * already records, so telling versions apart costs nothing extra to read.
 * Versions keep their real, shared filename: that is the archive's existing
 * convention (F1 Cash App's framed and clean prints, the upload route's
 * (event, original_filename, file_size) key, the recap's photo count), and it
 * keeps a person's B&W and color frames in one stack.
 */
import path from "node:path";

/** One archive entry: unzip's spelling (to read it), the real name (to record it), and its bytes' fingerprint. */
export interface ZipEntry {
  entry: string;
  name: string;
  crc: number;
  size: number;
}

/** One photograph to land: a distinct (filename, bytes) pair and every set it appears in. */
export interface PlannedPhoto {
  /** Unique within the archive. The bare filename when no other version shares it. */
  key: string;
  base: string;
  /** The name the pre-2026-09-11 ingest recorded (unzip's spelling). */
  legacy: string;
  zipPath: string;
  entry: string;
  crc: number;
  size: number;
  sets: string[];
}

export const JPEG = /\.(jpe?g)$/i;

const fingerprint = (crc: number, size: number) => `${crc >>> 0}:${size}`;

export function planEntries(byZip: { zipPath: string; entries: ZipEntry[] }[]) {
  /** base → its versions, in archive order. */
  const groups = new Map<string, PlannedPhoto[]>();
  const setOrder: string[] = [];

  for (const { zipPath, entries } of byZip) {
    for (const { entry, name, crc, size } of entries) {
      if (!JPEG.test(name)) continue;
      const slash = name.indexOf("/");
      const set = slash === -1 ? "(root)" : name.slice(0, slash);
      const base = path.basename(name);
      if (!setOrder.includes(set)) setOrder.push(set);

      const versions = groups.get(base) ?? [];
      const same = versions.find((v) => v.crc === crc && v.size === size);
      if (same) {
        // Same bytes, another set: a second section link, not a second upload.
        if (!same.sets.includes(set)) same.sets.push(set);
        continue;
      }
      versions.push({ key: base, base, legacy: path.basename(entry), zipPath, entry, crc, size, sets: [set] });
      groups.set(base, versions);
    }
  }

  // A version only needs a longer key when it has siblings.
  const photos = new Map<string, PlannedPhoto>();
  for (const versions of groups.values()) {
    for (const v of versions) {
      if (versions.length > 1) v.key = `${v.base}\u0000${fingerprint(v.crc, v.size)}`;
      photos.set(v.key, v);
    }
  }
  return { photos, groups, setOrder };
}

/**
 * How many different photographs the archive holds, counted from the bytes alone.
 *
 * Deliberately independent of `planEntries`: it is the number the landing check
 * compares the event against, and a check that reused the planner's idea of
 * identity could only ever agree with it (the collapse would have passed).
 */
export function distinctContent(entries: Iterable<Pick<ZipEntry, "name" | "crc" | "size">>): number {
  const seen = new Set<string>();
  for (const e of entries) if (JPEG.test(e.name)) seen.add(fingerprint(e.crc, e.size));
  return seen.size;
}

/** An image row already in the event, as far as matching needs it. */
export interface ExistingRow {
  id: string;
  original_filename: string | null;
  file_size: number | null;
  r2_key: string;
}

export interface MatchResult {
  /** Planned photos with no row yet. */
  todo: PlannedPhoto[];
  /** key → the image id that already holds those bytes. */
  existing: Map<string, string>;
  /**
   * Bases whose rows match none of the archive's versions. Nothing in such a
   * group is uploaded or relinked; the landing check then keeps the archive and
   * a human decides. Guessing here would either duplicate a photo or relink the
   * wrong one.
   */
  unmatched: { base: string; rowIds: string[] }[];
}

/**
 * Which planned photos the event already holds.
 *
 * A filename with one version keeps the old rule exactly (present by name, or by
 * unzip's legacy spelling). A filename with several versions is matched by
 * bytes: the row's `file_size` when exactly one version has that size, else the
 * CRC of the object in R2 (`fingerprintOf`, called only for the ambiguous rows).
 * Matching on bytes, never on archive order, is what keeps a re-downloaded ZIP
 * that lists versions in a different order from uploading one twice.
 */
export async function matchExisting(
  groups: Map<string, PlannedPhoto[]>,
  rows: readonly ExistingRow[],
  fingerprintOf: (row: ExistingRow) => Promise<{ crc: number; size: number }>,
): Promise<MatchResult> {
  const byName = new Map<string, ExistingRow[]>();
  for (const r of rows) {
    if (!r.original_filename) continue;
    const name = r.original_filename.normalize("NFC");
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }

  const todo: PlannedPhoto[] = [];
  const existing = new Map<string, string>();
  const unmatched: MatchResult["unmatched"] = [];

  for (const [base, versions] of groups) {
    const names = new Set([base, ...versions.map((v) => v.legacy)]);
    const groupRows = [...names].flatMap((n) => byName.get(n) ?? []);

    if (versions.length === 1) {
      const [v] = versions;
      // Present by name, as always, unless every row under the name records a
      // DIFFERENT size: then the event holds another file of that name (an SPS
      // pull, a merged event) and this one is not in it. Left for a human, like
      // any name whose rows match no version.
      const sized = groupRows.filter((r) => r.file_size != null);
      if (!groupRows.length) todo.push(v);
      else if (sized.length === groupRows.length && !sized.some((r) => r.file_size === v.size)) {
        unmatched.push({ base, rowIds: groupRows.map((r) => r.id) });
      } else existing.set(v.key, (groupRows.find((r) => r.file_size === v.size) ?? groupRows[0]).id);
      continue;
    }

    const claimed = new Map<string, string>();
    const strays: string[] = [];
    for (const row of groupRows) {
      let candidates = row.file_size == null ? [] : versions.filter((v) => v.size === row.file_size);
      if (candidates.length !== 1) {
        const fp = await fingerprintOf(row);
        candidates = versions.filter((v) => v.crc === fp.crc >>> 0 && v.size === fp.size);
      }
      if (candidates.length === 1) {
        if (!claimed.has(candidates[0].key)) claimed.set(candidates[0].key, row.id);
      } else {
        strays.push(row.id);
      }
    }
    if (strays.length) {
      unmatched.push({ base, rowIds: strays });
      continue;
    }
    for (const v of versions) {
      const id = claimed.get(v.key);
      if (id) existing.set(v.key, id);
      else todo.push(v);
    }
  }
  return { todo, existing, unmatched };
}

export interface SectionLink {
  section_id: string;
  image_id: string;
}

/**
 * Links to remove so each version sits only in the sets that hold its bytes.
 *
 * The collapse linked the one surviving version into EVERY set that carried its
 * name, so "BW" showed the color frame and SPIE's "Day 1" showed Day 2. Once the
 * missing versions have landed, those links are wrong, and each is named here
 * as an exact (section, image) pair. Two refusals keep a fix from becoming a
 * loss: a link is only removed when the right version is linked in that same
 * section, and only when the image keeps at least one link of its own.
 *
 * `imageIdOf` returns undefined for a version that failed to land; its whole
 * group is left untouched until a later run lands it.
 */
export function wrongVersionLinks(
  groups: Map<string, PlannedPhoto[]>,
  imageIdOf: (photo: PlannedPhoto) => string | undefined,
  sectionIdOf: (set: string) => string | undefined,
  links: readonly SectionLink[],
): SectionLink[] {
  const linked = new Set(links.map((l) => `${l.section_id}|${l.image_id}`));
  const out: SectionLink[] = [];

  for (const versions of groups.values()) {
    if (versions.length < 2) continue;
    const ids = versions.map(imageIdOf);
    if (ids.some((id) => !id)) continue;

    for (const [i, v] of versions.entries()) {
      const imageId = ids[i]!;
      // Compared as SECTION ids, never set names: "Day_1" and "Day 1" (or "BW"
      // and "bw") are one section, and a version is never removed from it.
      const ownSections = new Set(v.sets.map(sectionIdOf).filter((s): s is string => !!s));
      const keepsOne = [...ownSections].some((s) => linked.has(`${s}|${imageId}`));
      if (!keepsOne) continue;

      for (const [j, other] of versions.entries()) {
        if (j === i) continue;
        for (const set of other.sets) {
          const sid = sectionIdOf(set);
          if (!sid || ownSections.has(sid) || !linked.has(`${sid}|${imageId}`)) continue;
          if (!linked.has(`${sid}|${ids[j]}`)) continue;
          out.push({ section_id: sid, image_id: imageId });
        }
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((l) => {
    const k = `${l.section_id}|${l.image_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
