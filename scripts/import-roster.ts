/**
 * Import the "2 Dudes Roster" spreadsheet into the crew registry.
 *
 *   npx tsx scripts/import-roster.ts                 # DRY RUN
 *   npx tsx scripts/import-roster.ts --apply         # writes to PRODUCTION
 *   npx tsx scripts/import-roster.ts --file <path>   # a different export
 *
 * Fetch the source without touching Drive's UI (which froze the browser):
 *   https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx
 * in a signed-in browser downloads it straight to ~/Downloads.
 *
 * WHY THIS MATTERS. The calendars give stable EMAILS; the roster gives canonical
 * NAMES, city and capability. Joined on email, the identity pass stops being data
 * entry and becomes a review of pre-filled rows — which is the difference between
 * this dataset existing and not.
 *
 * The sheet a person appears on IS their pool: PhotographersDT, Stylists, MUA.
 * Note that photographer and digital tech share one sheet — that is how Mason
 * thinks of the POOL, and it must NOT collapse the per-event role, which stays a
 * set (people trade off mid-gig).
 *
 * PII: the roster also holds phone numbers, PayPal and Venmo handles. Those are
 * deliberately NOT imported. They have no role in this feature, and copying them
 * into a second system doubles the places they can leak from.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const fileArg = argv.indexOf("--file");
const XLSX_PATH =
  fileArg !== -1 ? argv[fileArg + 1] : path.join(os.homedir(), "Downloads", "2 Dudes Roster.xlsx");

/** Sheet name → the role pool it represents. */
const SHEET_POOLS: Record<string, string[]> = {
  PhotographersDT: ["photographer", "digital tech"],
  Stylists: ["stylist"],
  MUA: ["makeup artist"],
  "SLC Recs from Cory": ["photographer"],
};

/** Sheets whose people are LOCAL hires by default rather than staff. */
const LOCAL_SHEETS = new Set(["SLC Recs from Cory"]);

// ── a minimal xlsx reader (no dependency for a one-off import) ───────────────

interface Sheet {
  name: string;
  rows: string[][];
}

function readXlsx(file: string): Sheet[] {
  const present = new Set(listEntries(file));
  const get = (name: string) => (present.has(name) ? unzipEntry(file, name) : null);

  const wb = get("xl/workbook.xml")?.toString("utf8") ?? "";
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));

  const sharedXml = get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared: string[] = [];
  for (const si of sharedXml.split("<si>").slice(1)) {
    const text = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
    shared.push(decodeXml(text));
  }

  const out: Sheet[] = [];
  names.forEach((name, i) => {
    const xml = get(`xl/worksheets/sheet${i + 1}.xml`)?.toString("utf8");
    if (!xml) return;
    const rows: string[][] = [];
    for (const rowXml of xml.split("<row").slice(1)) {
      const cells: string[] = [];
      /**
       * Cells come in two shapes and BOTH have to be matched:
       *   <c r="B2" t="s"><v>40</v></c>     a value
       *   <c r="A2" s="3"/>                 empty, self-closing
       * Matching only the first form makes the regex run past every empty cell
       * to the next closing tag, so values land in the wrong columns and the
       * header row never matches. This sheet is mostly empty cells, so the
       * result was zero people parsed from 965 rows.
       */
      for (const m of rowXml.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = m[1];
        const inner = m[2] ?? "";
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref ? colIndex(ref) : cells.length;
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (v !== undefined) {
          value = /t="s"/.test(attrs) ? shared[Number(v)] ?? "" : v;
        } else {
          const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
          if (t) value = decodeXml(t);
        }
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      rows.push(cells);
    }
    out.push({ name, rows });
  });
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/**
 * Read entries with `unzip -p` rather than a hand-rolled ZIP parser.
 *
 * The first version walked local file headers directly and read ZERO sheets from
 * the real file: Google writes entries with a data descriptor, so `compSize` in
 * the local header is 0 and the actual length only appears after the data. The
 * repo already shells out to `unzip` for Pixieset archives; doing the same here
 * is both shorter and correct.
 */
function unzipEntry(file: string, entry: string): Buffer | null {
  const res = spawnSync("unzip", ["-p", file, entry], { maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 || !res.stdout?.length) return null;
  return res.stdout;
}

function listEntries(file: string): string[] {
  const res = spawnSync("unzip", ["-Z1", file], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (res.status !== 0) return [];
  return String(res.stdout).split("\n").map((l) => l.trim()).filter(Boolean);
}

// ── roster shape ────────────────────────────────────────────────────────────

interface Person {
  displayName: string;
  fullName: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
  canLead: string | null;
  travels: boolean | null;
  archived: boolean;
  notes: string | null;
  pools: string[];
  sheet: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const yesNo = (s: string): boolean | null => {
  const v = norm(s);
  if (!v) return null;
  if (/^y/.test(v)) return true;
  if (/^n/.test(v)) return false;
  return null;
};

/**
 * Find the header row.
 *
 * The four sheets do NOT share a layout, which is normal for a spreadsheet grown
 * by hand over years: PhotographersDT splits First/Middle/Last under a grouped
 * banner row, while Stylists and MUA use a single "Name" column. Accepting only
 * the first shape silently returned zero people from three of four sheets —
 * silent because an unparsed sheet and an empty sheet look identical.
 */
function findHeader(rows: string[][]): { at: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = rows[i].map(norm);
    if (cells.some((c) => c === "first name" || c === "name")) {
      const cols: Record<string, number> = {};
      cells.forEach((c, idx) => { if (c && cols[c] === undefined) cols[c] = idx; });
      return { at: i, cols };
    }
  }
  return null;
}

function readSheet(sheet: Sheet): { people: Person[]; unparsed: boolean } {
  const head = findHeader(sheet.rows);
  // No header at all — "SLC Recs from Cory" is a stacked freeform list, not a
  // table. Report it rather than returning an innocent-looking zero.
  if (!head) return { people: [], unparsed: true };
  const { cols } = head;
  const at = (row: string[], key: string) => (cols[key] !== undefined ? (row[cols[key]] ?? "").trim() : "");
  const people: Person[] = [];

  for (const row of sheet.rows.slice(head.at + 1)) {
    const whole = at(row, "name");                 // Stylists / MUA
    const first = at(row, "first name");           // PhotographersDT
    const last = at(row, "last name");
    const email = at(row, "email");
    if (!whole && !first && !last && !email) continue;

    const display = (whole || [first, last].filter(Boolean).join(" ")).trim() || email;
    if (!display) continue;

    people.push({
      displayName: display,
      fullName: (whole || [first, at(row, "middle name"), last].filter(Boolean).join(" ")).trim() || null,
      email: email ? email.toLowerCase() : null,
      city: at(row, "city") || null,
      region: at(row, "region") || null,
      canLead: at(row, "lead") ? norm(at(row, "lead")) : null,
      travels: yesNo(at(row, "traveler")),
      archived: !!yesNo(at(row, "archived")),
      notes: at(row, "notes") || null,
      pools: SHEET_POOLS[sheet.name] ?? [],
      sheet: sheet.name,
    });
  }
  return { people, unparsed: false };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`roster not found at ${XLSX_PATH}`);
    console.error(`download it with the xlsx export URL, or pass --file <path>`);
    process.exit(1);
  }

  const sheets = readXlsx(XLSX_PATH);
  console.log(`sheets: ${sheets.map((s) => s.name).join(", ")}`);
  console.log(APPLY ? "MODE: APPLY — writing to PRODUCTION\n" : "MODE: dry run (pass --apply to write)\n");

  const everyone: Person[] = [];
  const unparsedSheets: string[] = [];
  for (const sheet of sheets) {
    const { people, unparsed } = readSheet(sheet);
    if (unparsed) unparsedSheets.push(sheet.name);
    console.log(`  ${sheet.name.padEnd(20)} ${unparsed ? "NO HEADER ROW — not a table, skipped" : `${people.length} people`}`);
    everyone.push(...people);
  }

  /**
   * Merge by email, then by name. A person on two sheets (a stylist who also
   * shoots) is ONE crew member holding both pools — importing them twice would
   * seed the exact duplicate problem this registry exists to prevent.
   */
  const byKey = new Map<string, Person>();
  for (const p of everyone) {
    const key = p.email ? `e:${p.email}` : `n:${norm(p.displayName)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.pools = [...new Set([...existing.pools, ...p.pools])];
      existing.city ??= p.city;
      existing.region ??= p.region;
      existing.canLead ??= p.canLead;
      existing.travels ??= p.travels;
      existing.notes ??= p.notes;
    } else {
      byKey.set(key, { ...p });
    }
  }
  const merged = [...byKey.values()];
  const withEmail = merged.filter((p) => p.email).length;
  console.log(`\n${merged.length} distinct people (${withEmail} with an email, ${merged.length - withEmail} without)`);
  console.log(`   ${merged.filter((p) => p.archived).length} archived · ${merged.filter((p) => p.travels).length} travel · ${merged.filter((p) => p.canLead === "yes").length} can lead`);

  // Count SHEETS, not pools: PhotographersDT maps to two pools, so counting
  // pools would report every single person as multi-pool and mean nothing.
  const sheetCount = new Map<string, Set<string>>();
  for (const p of everyone) {
    const key = p.email ? `e:${p.email}` : `n:${norm(p.displayName)}`;
    (sheetCount.get(key) ?? sheetCount.set(key, new Set()).get(key)!).add(p.sheet);
  }
  const multi = [...sheetCount.values()].filter((s) => s.size > 1).length;
  if (multi) console.log(`   ${multi} appear on more than one sheet`);
  if (unparsedSheets.length) {
    console.log(`   ⚠ not imported (no header row): ${unparsedSheets.join(", ")} — add by hand or reshape the sheet`);
  }

  if (!APPLY) {
    console.log("\nsample of what would land (contact details deliberately not imported):");
    for (const p of merged.slice(0, 6)) {
      console.log(`   ${p.displayName.padEnd(22)} ${p.pools.join("+").padEnd(24)} lead=${p.canLead ?? "-"} city=${p.city ?? "-"}`);
    }
    console.log("\ndry run — nothing written.");
    return;
  }

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const supabase = createServiceClient();
  /* The generated types are regenerated from the live schema, but this script
     also has to run on a checkout whose types predate migration 056. A loose
     handle for the new tables keeps it runnable either way. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: owners, error: ownerErr } = await supabase.from("events").select("user_id").limit(500);
  if (ownerErr) throw ownerErr;
  const distinct = [...new Set((owners ?? []).map((o) => o.user_id))];
  if (distinct.length !== 1) {
    console.error(`cannot infer the owner (${distinct.length} users) — this import needs a single-tenant archive`);
    process.exit(1);
  }
  const userId = distinct[0];

  // Roles lookup, seeded from the pools the sheets imply.
  const roleNames = [...new Set(Object.values(SHEET_POOLS).flat())];
  for (const [i, name] of roleNames.entries()) {
    const { error } = await db
      .from("crew_roles")
      .upsert({ user_id: userId, name, sort_order: i }, { onConflict: "user_id,name" });
    if (error && !/duplicate|conflict/i.test(error.message)) throw error;
  }
  console.log(`roles seeded: ${roleNames.join(", ")}`);

  let inserted = 0, updated = 0, failed = 0;
  for (const p of merged) {
    // Existing person? Match on email first — it is the identity.
    let existingId: string | null = null;
    if (p.email) {
      const { data } = await db
        .from("crew").select("id").eq("user_id", userId).ilike("primary_email", p.email).maybeSingle();
      existingId = (data as { id?: string } | null)?.id ?? null;
    }
    if (!existingId) {
      const { data } = await db
        .from("crew").select("id").eq("user_id", userId).ilike("display_name", p.displayName).maybeSingle();
      existingId = (data as { id?: string } | null)?.id ?? null;
    }

    const row = {
      user_id: userId,
      display_name: p.displayName,
      full_name: p.fullName,
      primary_email: p.email,
      // The roster is one address per person; calendar aliases get merged later
      // by the identity pass, which is where Joey's two addresses join up.
      aliases: p.email ? [p.email] : [],
      kind: LOCAL_SHEETS.has(p.sheet) ? "local" : "staff",
      city: p.city,
      region: p.region,
      can_lead: p.canLead,
      travels: p.travels,
      archived: p.archived,
      notes: p.notes,
      updated_at: new Date().toISOString(),
    };

    const res = existingId
      ? await db.from("crew").update(row).eq("id", existingId)
      : await db.from("crew").insert(row);
    if (res.error) { failed++; console.error(`  ✗ ${p.displayName}: ${res.error.message}`); }
    else if (existingId) updated++;
    else inserted++;
  }

  console.log(`\n${inserted} inserted · ${updated} updated · ${failed} failed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
