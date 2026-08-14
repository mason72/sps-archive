/**
 * The identity pass: reconcile calendar attendee addresses with the crew registry.
 *
 *   npx tsx scripts/crew-identity.ts                  # propose, write nothing
 *   npx tsx scripts/crew-identity.ts --apply          # apply CONFIDENT merges only
 *   npx tsx scripts/crew-identity.ts --since 2016     # narrow the calendar sweep
 *   npx tsx scripts/crew-identity.ts --create-missing --min-gigs 10 --apply
 *
 * The problem, in one line from the real data: the roster knows
 * "Joseph Nagoshiner <joey@twodudesphoto.com>", the calendar knows
 * "joeynags@gmail.com", and the gig title says "JOEY". Three spellings, one
 * human. Email is the right canonical key, but only once the addresses that
 * belong to the same person are joined up.
 *
 * ── The rule that governs this file ──────────────────────────────────────────
 *
 * **Merging is proposed, never assumed.** Two different people can legitimately
 * both attend a gig, and a wrong merge silently attributes one person's work —
 * and one person's rebook rating — to another. So `--apply` only writes matches
 * this file can justify, and everything else is printed for a human. An
 * unresolved address costs a row in a report; a wrong merge costs the integrity
 * of every "who worked this venue" answer thereafter.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const CREATE_MISSING = argv.includes("--create-missing");
const minGigsArg = argv.indexOf("--min-gigs");
const MIN_GIGS = minGigsArg !== -1 ? Number(argv[minGigsArg + 1]) : 10;
const sinceArg = argv.indexOf("--since");
const SINCE = sinceArg !== -1 ? argv[sinceArg + 1] : "2014";

/**
 * Merges Mason confirmed by hand (2026-08-13). These are the staff who moved
 * from a personal address to a company one; he named them, so they need no
 * further evidence.
 */
const CONFIRMED: Record<string, string> = {
  "joeynags@gmail.com": "joey@twodudesphoto.com",
  "jerrickmitra@gmail.com": "jerrick@twodudesphoto.com",
  "isteratter@gmail.com": "justin@twodudesphoto.com",
  // Mason named Stretch among the staff who moved from a personal address to a
  // company one, and this handle has 319 gigs against his 0 under the company
  // address — the calendar knew him long before twodudesphoto.com did.
  "stretchington2005@gmail.com": "stretch@twodudesphoto.com",
  "christiejones0307@msn.com": "christiejones0307@gmail.com",
};

/**
 * Pairs a human has explicitly REJECTED. Without this the matcher re-proposes a
 * rejected merge on every run, and a suggestion that keeps coming back is one
 * that eventually gets accepted by accident.
 *
 * Justin Green is not Justin Heller (Mason, 2026-08-13) — they collided on the
 * bare first name "justin", which is why the local-part rule now demands a
 * distinctive handle.
 */
const NEVER_MERGE = new Set(["justin@justingreenphotography.com"]);

/**
 * Addresses that are not a human.
 *
 * `@group.calendar.google.com` matters most: a calendar invited to its own
 * events shows up as a 101-gig "attendee", which would otherwise become the
 * fourth busiest crew member on the books.
 */
const NOT_A_PERSON =
  /(^(info|hello|bookings?|accounts?|billing|no-?reply|2dudesphoto)@)|(@group\.calendar\.google\.com$)|(@resource\.calendar\.google\.com$)/i;

const norm = (s: string) => s.trim().toLowerCase();

/** Tokens from a name or an email local-part, for comparison. */
function tokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

/**
 * Does this address plausibly belong to this person?
 *
 * Deliberately conservative. The local-part must contain a whole name token, or
 * the display name must match — "j.smith" is not evidence for "Jane Smith"
 * against a roster that also holds a John Smith.
 */
function scoreMatch(
  email: string,
  displayName: string | null,
  person: { display_name: string; full_name: string | null; primary_email?: string | null; aliases?: string[] | null }
): { score: number; why: string } | null {
  const local = email.split("@")[0];

  const knownLocals = [person.primary_email, ...(person.aliases ?? [])]
    .filter(Boolean)
    .map((a) => String(a).split("@")[0].toLowerCase());
  /**
   * Identical local-part is near-proof, but ONLY when the handle is distinctive.
   * A bare first name is not: justin@justingreenphotography.com matched Justin
   * Heller on "justin" and would have credited one photographer's twelve years
   * to another. Require a surname, a separator or digits — evidence the handle
   * identifies a person rather than merely greets one.
   */
  const distinctive = local.length >= 10 || (local.length >= 8 && /[._\-0-9]/.test(local));
  if (distinctive && knownLocals.includes(local.toLowerCase())) {
    return { score: 0.95, why: `same distinctive local-part as ${person.primary_email}` };
  }
  const nameTokens = new Set([...tokens(person.display_name), ...tokens(person.full_name ?? "")]);
  const localTokens = tokens(local);

  /**
   * Identical local-part across different domains is the strongest signal there
   * is short of an exact address: christiejones0307@msn.com and
   * christiejones0307@gmail.com are one person who changed provider, and no two
   * different people pick the same distinctive handle. Guarded on length so
   * "info@" or "mason@" cannot collapse two organisations.
   */
  for (const known of [person.display_name, person.full_name ?? ""]) void known;
  if (displayName && norm(displayName) === norm(person.display_name)) {
    return { score: 0.95, why: "calendar display name matches exactly" };
  }
  if (displayName) {
    const dn = new Set(tokens(displayName));
    const shared = [...dn].filter((t) => nameTokens.has(t));
    if (shared.length >= 2) return { score: 0.9, why: `display name shares ${shared.join("+")}` };
  }
  const sharedLocal = localTokens.filter((t) => nameTokens.has(t));
  if (sharedLocal.length >= 2) {
    return { score: 0.85, why: `local-part contains ${sharedLocal.join("+")}` };
  }
  // A single long token is weak but worth surfacing: "jerrickmitra" → "jerrick".
  const longHit = [...nameTokens].find((t) => t.length >= 5 && local.includes(t));
  if (longHit) return { score: 0.6, why: `local-part contains "${longHit}"` };
  return null;
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { listEvents, CALENDARS } = await import("../src/lib/event-intel/google-calendar");
  const { parseGig } = await import("../src/lib/event-intel/parse-calendar");
  // The generated types may predate migration 056 on some checkouts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  console.log(APPLY ? "MODE: APPLY — writing confident merges\n" : "MODE: propose only\n");

  // ── every attendee address the calendars have ever seen ──
  const seen = new Map<string, { names: Set<string>; gigs: number }>();
  for (const key of Object.keys(CALENDARS) as (keyof typeof CALENDARS)[]) {
    const events = await listEvents(key, { timeMin: `${SINCE}-01-01T00:00:00Z` });
    let gigs = 0;
    for (const ev of events) {
      const g = parseGig(ev);
      if (g.kind !== "gig" && g.kind !== "setup") continue;
      gigs++;
      for (const a of g.attendees) {
        if (NOT_A_PERSON.test(a.email)) continue;
        const rec = seen.get(a.email) ?? { names: new Set<string>(), gigs: 0 };
        if (a.displayName) rec.names.add(a.displayName);
        rec.gigs++;
        seen.set(a.email, rec);
      }
    }
    console.log(`  ${key.padEnd(9)} ${events.length} entries, ${gigs} gigs`);
  }
  console.log(`\n${seen.size} distinct attendee addresses across both calendars\n`);

  // ── the registry ──
  const { data: crew, error } = await db
    .from("crew")
    .select("id, display_name, full_name, primary_email, aliases");
  if (error) throw error;

  const byAddress = new Map<string, { id: string; display_name: string }>();
  for (const c of crew ?? []) {
    for (const a of [c.primary_email, ...(c.aliases ?? [])]) {
      if (a) byAddress.set(norm(a), c);
    }
  }

  const already: string[] = [];
  const confident: { email: string; person: { id: string; display_name: string }; why: string; gigs: number }[] = [];
  const review: { email: string; names: string[]; gigs: number; best?: string; why?: string }[] = [];

  for (const [email, rec] of [...seen.entries()].sort((a, b) => b[1].gigs - a[1].gigs)) {
    if (byAddress.has(email)) { already.push(email); continue; }

    if (NEVER_MERGE.has(email)) {
      review.push({ email, names: [...rec.names], gigs: rec.gigs, best: undefined, why: "rejected by Mason — never merge" });
      continue;
    }
    // Mason's confirmed list wins outright.
    const target = CONFIRMED[email];
    if (target) {
      const person = byAddress.get(norm(target));
      if (person) {
        confident.push({ email, person, why: "confirmed by Mason", gigs: rec.gigs });
        continue;
      }
    }

    let best: { person: { id: string; display_name: string }; score: number; why: string } | null = null;
    for (const c of crew ?? []) {
      const displayName = [...rec.names][0] ?? null;
      const s = scoreMatch(email, displayName, c);
      if (s && (!best || s.score > best.score)) best = { person: c, score: s.score, why: s.why };
    }

    if (best && best.score >= 0.85) {
      confident.push({ email, person: best.person, why: best.why, gigs: rec.gigs });
    } else {
      review.push({
        email,
        names: [...rec.names],
        gigs: rec.gigs,
        best: best?.person.display_name,
        why: best?.why,
      });
    }
  }

  console.log(`${already.length} already resolved`);
  console.log(`${confident.length} confident merges`);
  console.log(`${review.length} need a human\n`);

  if (confident.length) {
    console.log("CONFIDENT — would attach these addresses to existing people:");
    for (const c of confident.slice(0, 30)) {
      console.log(`  ${c.email.padEnd(34)} → ${c.person.display_name.padEnd(24)} (${c.why}, ${c.gigs} gigs)`);
    }
    if (confident.length > 30) console.log(`  …and ${confident.length - 30} more`);
  }

  if (review.length) {
    console.log("\nNEEDS A HUMAN — most-worked first:");
    for (const r of review.slice(0, 25)) {
      const hint = r.best ? `  maybe ${r.best}? (${r.why})` : "  no candidate";
      console.log(`  ${r.email.padEnd(34)} ${String(r.gigs).padStart(4)} gigs  ${(r.names[0] ?? "").padEnd(22)}${hint}`);
    }
    if (review.length > 25) console.log(`  …and ${review.length - 25} more`);
  }

  if (!APPLY) {
    console.log("\npropose only — nothing written. Re-run with --apply to attach the confident ones.");
    return;
  }

  let applied = 0;
  for (const c of confident) {
    const { data: row } = await db.from("crew").select("aliases").eq("id", c.person.id).single();
    const aliases = new Set<string>([...(row?.aliases ?? []), c.email]);
    const { error: updErr } = await db
      .from("crew")
      .update({ aliases: [...aliases], updated_at: new Date().toISOString() })
      .eq("id", c.person.id);
    if (updErr) console.error(`  ✗ ${c.email}: ${updErr.message}`);
    else applied++;
  }
  console.log(`\n${applied} address(es) attached.`);

  /**
   * Create people the roster never had.
   *
   * Most of the unresolved addresses are not aliases at all — they are crew who
   * predate the current spreadsheet. Cari Courtright has worked 150 gigs and
   * appears nowhere on it. Merging is the wrong answer for them; they need a
   * record of their own.
   *
   * Gated on BOTH a display name and a gig threshold, because those two together
   * are what distinguish a colleague from a client who was once cc'd on an
   * invite. Everything below the line stays in the report for a human, since
   * inventing a crew member out of a one-off attendee is its own kind of wrong.
   */
  if (!CREATE_MISSING) {
    console.log(`${review.length} still need a human — pass --create-missing to add the frequent ones.`);
    return;
  }

  const { data: owners } = await db.from("events").select("user_id").limit(500);
  const distinct = [...new Set((owners ?? []).map((o: { user_id: string }) => o.user_id))];
  if (distinct.length !== 1) {
    console.error("cannot infer the owner — refusing to create crew");
    return;
  }
  const userId = distinct[0];

  const candidates = review.filter((r) => r.gigs >= MIN_GIGS && r.names.length > 0);

  /**
   * GROUP BY NAME BEFORE CREATING.
   *
   * Creating per ADDRESS produced Cari Courtright twice (cari@caricourtright.com
   * and cari@twodudesphoto.com) and Elena Reeder twice — one human, two records,
   * which is precisely the duplication this registry exists to prevent. A person
   * with several addresses is one row with several aliases.
   *
   * The company address wins as primary where there is one, matching the rule
   * that @twodudesphoto.com is current and personal mail is legacy.
   */
  const byName = new Map<string, { name: string; emails: string[]; gigs: number }>();
  for (const c of candidates) {
    const key = norm(c.names[0]);
    const g = byName.get(key) ?? { name: c.names[0], emails: [], gigs: 0 };
    g.emails.push(c.email);
    g.gigs += c.gigs;
    byName.set(key, g);
  }
  const people = [...byName.values()];
  console.log(`\ncreating ${people.length} people with a name and >= ${MIN_GIGS} gigs (from ${candidates.length} addresses):`);

  let created = 0;
  for (const p of people) {
    const company = p.emails.find((e) => /@twodudesphoto\.com$/i.test(e));
    const primary = company ?? p.emails[0];
    const { error: insErr } = await db.from("crew").insert({
      user_id: userId,
      display_name: p.name,
      full_name: p.name,
      primary_email: primary,
      aliases: [...new Set(p.emails)],
      // Not on the roster and not on a company domain: treat as a contractor
      // until a human says otherwise. Wrong-but-visible beats wrong-and-implied.
      kind: company ? "staff" : "local",
      notes: `Created from ${p.gigs} calendar gigs; not on the roster spreadsheet.`,
    });
    if (insErr) console.error(`  ✗ ${p.name}: ${insErr.message}`);
    else {
      created++;
      const extra = p.emails.length > 1 ? ` (+${p.emails.length - 1} alias)` : "";
      console.log(`  + ${p.name.padEnd(24)} ${primary.padEnd(34)} ${p.gigs} gigs${extra}`);
    }
  }
  console.log(`\n${created} created. ${review.length - candidates.length} below the threshold, still for a human.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
