import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await s.auth.admin.listUsers({ perPage: 200 });
  if (error) { console.error(error.message); process.exit(2); }
  console.log(`total users: ${data.users.length}`);
  for (const u of data.users) console.log(`${u.id}  ${u.email}  last_sign_in=${u.last_sign_in_at ?? "never"}`);
}
main();
