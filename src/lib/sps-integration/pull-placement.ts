/**
 * Where a re-fetched photo goes: beside the person's other photos.
 *
 * The walk lands every photo in the "Unsorted" intake, which is right for a
 * first import. The closing sweep and "Retry N photos" run later, sometimes
 * days later, after "Sort into sections" has consumed the intake. Until
 * 2026-10-04 they went through `intakeAppendPoint()` regardless, which CREATED
 * a new "Unsorted" holding only the retried photos. AAOMS 2026 got a tab of 5
 * beside A–B … T–Z on a gallery with a live share, while each of those five
 * people's other frames sat in exactly one letter section.
 *
 * ── The rule (Mason, 2026-10-04) ──
 *
 * A swept photo joins the section that already holds its person's other
 * photos WHEN EXACTLY ONE SECTION DOES. Otherwise it goes to the intake as
 * before, and the intake is created only if a photo in the batch needs it.
 *
 * - **Who the person is** is the stack `buildStacks` puts the photo in,
 *   computed over the event's rows plus the incoming photos. The editor's
 *   grid, the guest gallery and "Sort into sections" all group that way; a
 *   name is never derived here.
 * - **Two sections are never a home.** Highlights holds COPIES of photos that
 *   live in another section; counted, every person with a pick there would
 *   have two sections. And "Unsorted" means not filed: one stray sitting in
 *   it must not send the person's next photo there as well. A person whose
 *   photos are ALL in the intake has no home and lands in the intake, which
 *   is the same place.
 * - **A locked section holds photos but cannot receive one**, the same answer
 *   the upload route gives (423). A person filed in a locked section falls
 *   back to the intake.
 * - **One rule for the first run's sweep and for a later retry.** In a gallery
 *   nobody has sorted, everything is in the intake, so the photo lands there
 *   exactly as before.
 *
 * Bytes still land before the row, and every photo still gets a section link:
 * this only chooses WHICH section `importOneImage` links.
 *
 * ── Two things it must not do ──
 *
 * **Create "Unsorted" for a photo that never arrives.** The intake is found
 * or created when the first photo that needs it is PLACED, and a photo is
 * placed only after its bytes are in R2. A retry list is made of photos that
 * failed before; one of them failing again must not leave an empty tab on a
 * delivered gallery.
 *
 * **Guess when it cannot read.** If the lookup fails, nothing moves: the
 * error is thrown, the step is retried, and a sweep that still cannot run
 * ends with its photos listed as owed, with the Retry button. Falling back to
 * the intake instead would rebuild the stray "Unsorted" tab at exactly the
 * moment retries happen (a struggling database), and it would stick, because
 * a photo that has landed is never placed again.
 */
import { buildStacks } from "@/lib/gallery/stacks";
import { INTAKE_SECTION_NAME, isCuratedSectionName } from "@/lib/sections/intake";
import type { createServiceClient } from "@/lib/supabase/server";
import { parseFilename } from "@/lib/upload/parse-filename";
import type { SpsManifestImage } from "./pull-client";
import { intakeAppendPoint, sectionAppendPoint, type Placement } from "./pull-event";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Rows per read of the event's photos. PostgREST caps a response at 1,000. */
const ROW_PAGE = 1000;

/** Ids per `.in()` filter: the list travels in the query string. */
const ID_CHUNK = 100;

/** The fields `buildStacks` groups by. */
export interface PlacementRow {
  id: string;
  parsedName: string | null;
  originalFilename: string;
}

export interface PlacementSection {
  id: string;
  name: string;
  locked: boolean;
}

/**
 * For each incoming photo, the photos already in the event that share its
 * stack. Incoming photos of one person share ONE array, so a caller can look
 * a stack's sections up once.
 */
export function stackMates(
  existing: PlacementRow[],
  incoming: SpsManifestImage[]
): Map<string, string[]> {
  const entries = [
    ...existing.map((row) => ({ ...row, incoming: false })),
    ...incoming.map((image) => ({
      id: image.id,
      // The same call `importOneImage` makes for the row's `parsed_name`, so
      // the photo is grouped here as it will be once it has landed.
      parsedName: parseFilename(image.originalFilename).name,
      originalFilename: image.originalFilename,
      incoming: true,
    })),
  ];
  const mates = new Map<string, string[]>();
  for (const stack of buildStacks(entries)) {
    const arriving = stack.images.filter((e) => e.incoming);
    if (!arriving.length) continue;
    const here = stack.images.filter((e) => !e.incoming).map((e) => e.id);
    for (const a of arriving) mates.set(a.id, here);
  }
  return mates;
}

/** The "Unsorted" intake, matched the way `intakeAppendPoint` finds it. */
function isIntakeSectionName(name: string): boolean {
  return name.toLowerCase() === INTAKE_SECTION_NAME.toLowerCase();
}

/**
 * The sections that count as where a person's photos are FILED, among the
 * sections their photos are linked into. Three kinds of link say nothing
 * about that: another event's section (a photo published to a website
 * gallery), Highlights (a copy), and the intake (not filed yet).
 */
export function homesAmong(
  memberships: Iterable<string>,
  sections: ReadonlyMap<string, PlacementSection>
): Set<string> {
  const homes = new Set<string>();
  for (const id of memberships) {
    const section = sections.get(id);
    if (!section) continue;
    if (isCuratedSectionName(section.name) || isIntakeSectionName(section.name)) continue;
    homes.add(id);
  }
  return homes;
}

/** The one section a photo may join, or null for the intake. */
export function chooseHome(
  homes: ReadonlySet<string>,
  sections: ReadonlyMap<string, PlacementSection>
): string | null {
  if (homes.size !== 1) return null;
  const [only] = homes;
  return sections.get(only)?.locked ? null : only;
}

async function loadEventSections(
  supabase: SupabaseDB,
  eventId: string
): Promise<Map<string, PlacementSection>> {
  // Per-person sorting makes hundreds of sections, so this pages too.
  const sections = new Map<string, PlacementSection>();
  for (let last: string | null = null; ; ) {
    let query = supabase
      .from("sections")
      .select("id, name, locked")
      .eq("event_id", eventId)
      .order("id", { ascending: true })
      .limit(ROW_PAGE);
    if (last) query = query.gt("id", last);
    const { data, error } = await query;
    if (error) throw error;
    for (const s of data ?? []) sections.set(s.id, s);
    if ((data ?? []).length < ROW_PAGE) return sections;
    last = data![data!.length - 1].id;
  }
}

async function loadEventRows(
  supabase: SupabaseDB,
  eventId: string
): Promise<PlacementRow[]> {
  // Keyset, not OFFSET: the sweep's own inserts (and any upload in flight)
  // land at random ids, which would shift an offset page under the read.
  const rows: PlacementRow[] = [];
  for (let last: string | null = null; ; ) {
    let query = supabase
      .from("images")
      .select("id, parsed_name, original_filename")
      .eq("event_id", eventId)
      .order("id", { ascending: true })
      .limit(ROW_PAGE);
    if (last) query = query.gt("id", last);
    const { data, error } = await query;
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        parsedName: r.parsed_name,
        originalFilename: r.original_filename,
      });
    }
    if ((data ?? []).length < ROW_PAGE) return rows;
    last = data![data!.length - 1].id;
  }
}

/** The one section these photos are filed in, or null. */
async function homeOf(
  supabase: SupabaseDB,
  imageIds: string[],
  sections: ReadonlyMap<string, PlacementSection>
): Promise<string | null> {
  const memberships: string[] = [];
  for (let i = 0; i < imageIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("section_images")
      .select("section_id")
      .in("image_id", imageIds.slice(i, i + ID_CHUNK));
    if (error) throw error;
    // A full response may be a truncated one, and a truncated read could hide
    // the second section. Not knowing is "no single home".
    if ((data ?? []).length >= ROW_PAGE) return null;
    for (const link of data ?? []) memberships.push(link.section_id);
    // Two homes settle it. A stack of every "IMG_" file in a gallery is
    // thousands of photos; this stops at the first chunk that spans sections.
    if (homesAmong(memberships, sections).size > 1) return null;
  }
  return chooseHome(homesAmong(memberships, sections), sections);
}

/**
 * Each incoming photo's home section, for the photos that have one.
 * Read-only. Exported for `scripts/triage/sps-placement-probe.ts`.
 */
export async function findHomes(
  supabase: SupabaseDB,
  eventId: string,
  batch: SpsManifestImage[]
): Promise<Map<string, string>> {
  const sections = await loadEventSections(supabase, eventId);
  const mates = stackMates(await loadEventRows(supabase, eventId), batch);

  const byStack = new Map<string[], string | null>();
  const homes = new Map<string, string>();
  for (const image of batch) {
    const others = mates.get(image.id);
    if (!others?.length) continue;
    if (!byStack.has(others)) {
      byStack.set(others, await homeOf(supabase, others, sections));
    }
    const home = byStack.get(others);
    if (home) homes.set(image.id, home);
  }
  return homes;
}

/** Where one photo of the batch goes. Call once per photo, as it lands. */
export type Placer = (image: SpsManifestImage) => Promise<Placement>;

/**
 * Decide where every photo in a sweep batch goes, before any byte moves.
 *
 * Returns a function rather than a table for two reasons. Sort positions are
 * handed out as photos land: each section appends after what it holds, and
 * two photos bound for one section never share a position. And the intake is
 * only looked for, or created, by the first photo that needs it.
 *
 * Throws if the lookup cannot be read. See the header: nothing is placed on a
 * guess.
 */
export async function planSweepPlacement(
  supabase: SupabaseDB,
  eventId: string,
  batch: SpsManifestImage[]
): Promise<Placer> {
  const homes = await findHomes(supabase, eventId, batch);
  const next = new Map<string, number>();
  for (const sectionId of new Set(homes.values())) {
    next.set(sectionId, await sectionAppendPoint(supabase, sectionId));
  }

  // One lookup shared by every worker that needs it. A failed one is
  // forgotten, so the next photo asks again and is not failed by an old error.
  let intake: Promise<string> | null = null;
  const intakeSection = () => {
    intake ??= intakeAppendPoint(supabase, eventId).then(
      (point) => {
        next.set(point.sectionId, point.sortBase);
        return point.sectionId;
      },
      (err) => {
        intake = null;
        throw err;
      }
    );
    return intake;
  };

  return async (image) => {
    const sectionId = homes.get(image.id) ?? (await intakeSection());
    const sortOrder = next.get(sectionId) ?? 0;
    next.set(sectionId, sortOrder + 1);
    return { sectionId, sortOrder };
  };
}
