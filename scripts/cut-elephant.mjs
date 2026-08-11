/**
 * Slice public/logo.png into the cut-out puppet parts used by ElephantWalk.
 * Re-run after any logo change: `node scripts/cut-elephant.mjs`
 * Boxes were measured off the alpha mask (see tasks/lessons.md #67).
 */
import sharp from "sharp";
const SRC = "public/logo.png";
const OUT = "public/elephant";

/**
 * Boxes measured off the alpha mask + a zoom of the trunk zone, not eyeballed.
 * Legs extend well ABOVE the belly so their pivots sit under the body layer —
 * a hip that rotates outside its own covering would tear open on every step.
 */
const BODY = { left: 203, top: 350, width: 1180, height: 600 };
const PARTS = {
  "leg-rear-far":   { left: 396,  top: 880, width: 175, height: 322 },
  "leg-rear-near":  { left: 218,  top: 880, width: 180, height: 322 },
  "leg-front-far":  { left: 960,  top: 880, width: 168, height: 322 },
  "leg-front-near": { left: 740,  top: 880, width: 150, height: 322 },
  tail:             { left: 200,  top: 700, width: 82,  height: 250 },
  trunk:            { left: 1230, top: 782, width: 132, height: 280 },
};

for (const [name, box] of Object.entries(PARTS)) {
  await sharp(SRC).extract(box).png().toFile(`${OUT}/${name}.png`);
}

// The body must NOT still contain the parts that now move independently, or
// they double-render: a static trunk showing through a swinging one.
const knockouts = ["tail", "trunk"]
  .map((n) => PARTS[n])
  .map(
    (b) =>
      `<rect x="${b.left - BODY.left}" y="${b.top - BODY.top}" width="${b.width}" height="${b.height}" fill="#fff"/>`
  )
  .join("");
await sharp(SRC)
  .extract(BODY)
  .composite([
    {
      input: Buffer.from(
        `<svg width="${BODY.width}" height="${BODY.height}">${knockouts}</svg>`
      ),
      blend: "dest-out",
    },
  ])
  .png()
  .toFile(`${OUT}/body.png`);

const names = [...Object.keys(PARTS), "body"];
const tiles = await Promise.all(
  names.map((n) =>
    sharp(`${OUT}/${n}.png`)
      .resize(200, 200, { fit: "contain", background: { r: 245, g: 245, b: 244, alpha: 1 } })
      .toBuffer()
  )
);
await sharp({ create: { width: 200 * names.length, height: 200, channels: 4, background: "#f5f5f4" } })
  .composite(tiles.map((input, i) => ({ input, left: i * 200, top: 0 })))
  .png()
  .toFile("/tmp/parts.png");
console.log("parts:", names.join(", "));
