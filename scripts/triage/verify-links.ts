import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("events").select("name, settings");
  for (const e of data ?? []) {
    const st = (e.settings ?? {}) as Record<string, unknown>;
    if (st.source === "manual-link") {
      console.log(`PT "${e.name}"  ←  SPS "${st.spsEventName}"  (linked ${String(st.spsLinkedAt).slice(0,16)})`);
    }
  }
})();
