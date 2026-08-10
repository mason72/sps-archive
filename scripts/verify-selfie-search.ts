/**
 * Selfie-search E2E: pick a wedding guest with a decent-size person cluster,
 * download ONE of their photos (thumb-lg), send it as the "selfie" to the
 * guest endpoint, and check the response returns that person's OTHER photos.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const SLUG = "2wH2RoCUsq";
const EVENT_ID = "b4f42922-0e30-48f9-8496-51b5a48db10b";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { getPresignedDownloadUrl, getThumbnailKey } = await import(
    "../src/lib/r2/client"
  );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // A person with a healthy cluster (5-40 photos) in the wedding.
  const { data: persons } = await supabase
    .from("persons")
    .select("id, face_count")
    .eq("event_id", EVENT_ID)
    .gte("face_count", 5)
    .lte("face_count", 40)
    .order("face_count", { ascending: false })
    .limit(1);
  const person = persons?.[0];
  if (!person) throw new Error("no suitable person");

  const { data: faces } = await supabase
    .from("faces")
    .select("image_id, quality")
    .eq("person_id", person.id)
    .order("quality", { ascending: false })
    .limit(1000);
  const personImages = new Set((faces ?? []).map((f) => f.image_id));
  const probeImageId = (faces ?? [])[0].image_id;

  const { data: img } = await supabase
    .from("images")
    .select("r2_key")
    .eq("id", probeImageId)
    .single();
  const url = await getPresignedDownloadUrl(getThumbnailKey(img!.r2_key, "thumb-lg"), 600);
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  console.log(`probe person ${person.id.slice(0, 8)}: ${personImages.size} images; selfie = ${probeImageId.slice(0, 8)} (${bytes.length} bytes)`);

  const t0 = Date.now();
  const res = await fetch(`http://localhost:3005/api/gallery/${SLUG}/selfie-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: bytes.toString("base64") }),
  });
  console.log(`status ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const data = (await res.json()) as { results?: string[]; matchedPerson?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error);

  const returned = new Set(data.results ?? []);
  const overlap = [...personImages].filter((id) => returned.has(id)).length;
  console.log(
    `matchedPerson=${data.matchedPerson}; returned ${returned.size} images; ` +
      `${overlap}/${personImages.size} of the person's images present`
  );
  if (!returned.has(probeImageId)) console.log("note: probe image itself not returned");
  if (data.matchedPerson && overlap >= personImages.size * 0.9) {
    console.log("PASS: person identified, near-complete recall");
  } else {
    console.log("REVIEW: weaker than expected");
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
