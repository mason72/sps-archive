import fs from "node:fs";
process.chdir(process.env.HOME + "/Projects/SPS/sps-archive");
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

// each replacement's '?' count MUST equal the UTF-8 byte length of the character
const RULES = [
  { from: "Na??jera",     to: "Nájera"     },
  { from: "O???Dwyer",    to: "O’Dwyer"    },
  { from: "O???Loughlin", to: "O’Loughlin" },
];
for (const r of RULES) {
  const q = (r.from.match(/\?/g) || []).length;
  const ch = [...r.to].find(c => c.charCodeAt(0) > 127);
  const bytes = Buffer.byteLength(ch, "utf8");
  r.ok = q === bytes;
  console.log(`rule ${r.from} -> ${r.to}   '?'=${q}  "${ch}"=${bytes} bytes  ${r.ok ? "CONSISTENT" : "*** MISMATCH ***"}`);
}
if (RULES.some(r => !r.ok)) { console.log("refusing: a rule's ? count does not match its character's byte length"); process.exit(1); }

const { data: ev } = await sb.from("events").select("id,name").ilike("name","%Kinexions%").limit(1);
const { data } = await sb.from("images").select("id,original_filename")
  .eq("event_id", ev[0].id).like("original_filename","%?%");
console.log(`\nmangled rows in ${ev[0].name}: ${data.length}\n`);
let changed = 0, skipped = 0;
for (const img of data) {
  let name = img.original_filename;
  for (const r of RULES) name = name.split(r.from).join(r.to);
  if (name === img.original_filename || name.includes("?")) { skipped++; console.log(`  SKIP (no rule) ${img.original_filename}`); continue; }
  console.log(`  ${img.original_filename}\n      -> ${name}`);
  if (APPLY) {
    const { error } = await sb.from("images").update({ original_filename: name }).eq("id", img.id);
    if (error) { console.log(`      FAILED: ${error.message}`); continue; }
  }
  changed++;
}
console.log(`\n${APPLY ? "updated" : "would update"}: ${changed}   skipped: ${skipped}`);
