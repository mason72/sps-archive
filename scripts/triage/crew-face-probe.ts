import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = "d5b2e276-d33d-49b3-ba09-59164c622b21";

  const { data: links } = await s.from("crew_persons").select("*");
  console.log("crew_persons rows:", JSON.stringify(links));

  const { data: refs } = await s.from("crew_faces").select("id, crew_id, image_id, face_id, is_avatar, source");
  console.log("crew_faces rows:", JSON.stringify(refs));

  // The person + representative
  const { data: person, error: pErr } = await s
    .from("persons")
    .select("id, representative_face_id, events!inner(user_id)")
    .eq("id", "8eb3f00a-2aa0-4a7f-bdc5-b9230d996ee8")
    .eq("events.user_id", userId)
    .maybeSingle();
  console.log("person:", JSON.stringify(person), "err:", pErr?.message);

  if (person?.representative_face_id) {
    // Reproduce addTaggedFace's exact ownership query
    const { data: face, error: fErr } = await s
      .from("faces")
      .select("id, image_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding, images!inner(id, events!inner(user_id))")
      .eq("id", person.representative_face_id)
      .eq("images.events.user_id", userId)
      .maybeSingle();
    console.log("face found:", !!face, "err:", fErr?.message, face ? `embedding len=${String(face.embedding).length}` : "");
  }
}
main();

// Re-verify the HINTED embed works (appended after the fix):
async function verifyHint() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await s
    .from("faces")
    .select("id, embedding, images!inner(id, events!images_event_id_fkey!inner(user_id))")
    .eq("id", "7cf477f1-05f6-4bf0-86f8-422741798748")
    .eq("images.events.user_id", "d5b2e276-d33d-49b3-ba09-59164c622b21")
    .maybeSingle();
  console.log("HINTED embed:", !!data ? "FOUND" : "not found", "err:", error?.message ?? "none");
}
verifyHint();
