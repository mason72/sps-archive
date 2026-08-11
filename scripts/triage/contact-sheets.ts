/**
 * Build labelled contact sheets of one representative frame per moment.
 * Read-only against R2.
 *
 *   npx tsx scripts/triage/contact-sheets.ts <eventId> [--cols 5] [--rows 5]
 *                                            [--cell 300] [--only 3,7,12]
 *                                            [--out dir]
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: contact-sheets.ts <eventId>");
  const cols = Number(arg("cols", "5"));
  const rows = Number(arg("rows", "5"));
  const cell = Number(arg("cell", "300"));
  const outDir = arg("out", `scripts/triage/data/sheets-${eventId.slice(0, 8)}`);
  const only = arg("only", "");
  const onlySet = only ? new Set(only.split(",").map((v) => Number(v.trim()))) : null;

  const sharp = (await import("sharp")).default;
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");

  const manifest: {
    moment: number;
    frames: number;
    rep_key: string;
    taken_at: string;
    orientation: string;
  }[] = JSON.parse(fs.readFileSync(`scripts/triage/data/moments-${eventId}.json`, "utf8"));

  const items = manifest.filter((m) => !onlySet || onlySet.has(m.moment));
  console.log(`composing ${items.length} moments → ${cols}x${rows} sheets, cell ${cell}px`);
  fs.mkdirSync(outDir, { recursive: true });

  const labelH = 26;
  const cellH = Math.round(cell * 1.28);
  const perSheet = cols * rows;
  const cache = new Map<string, Buffer>();

  async function cellImage(it: (typeof items)[number]): Promise<Buffer> {
    const key = getThumbnailKey(it.rep_key, "thumb-md");
    let buf = cache.get(key);
    if (!buf) {
      buf = await getObjectBuffer(key);
      cache.set(key, buf);
    }
    const img = await sharp(buf)
      .resize(cell, cellH, { fit: "contain", background: { r: 24, g: 24, b: 24 } })
      .toBuffer();
    const label = `${it.moment}${it.frames > 1 ? `  ·${it.frames}` : ""}`;
    const svg = Buffer.from(
      `<svg width="${cell}" height="${labelH}"><rect width="${cell}" height="${labelH}" fill="#111"/>` +
        `<text x="6" y="18" font-family="monospace" font-size="15" fill="#fff">${label}</text></svg>`
    );
    return sharp({
      create: { width: cell, height: cellH + labelH, channels: 3, background: { r: 17, g: 17, b: 17 } },
    })
      .composite([
        { input: img, top: 0, left: 0 },
        { input: svg, top: cellH, left: 0 },
      ])
      .png()
      .toBuffer();
  }

  for (let sheet = 0; sheet * perSheet < items.length; sheet++) {
    const slice = items.slice(sheet * perSheet, (sheet + 1) * perSheet);
    const cellsBuf = await Promise.all(slice.map((it) => cellImage(it).catch(() => null)));
    const W = cols * cell;
    const H = Math.ceil(slice.length / cols) * (cellH + labelH);
    const composites = cellsBuf
      .map((b, i) =>
        b
          ? {
              input: b,
              left: (i % cols) * cell,
              top: Math.floor(i / cols) * (cellH + labelH),
            }
          : null
      )
      .filter(Boolean) as { input: Buffer; left: number; top: number }[];
    const file = path.join(outDir, `sheet-${String(sheet).padStart(2, "0")}.jpg`);
    await sharp({ create: { width: W, height: H, channels: 3, background: { r: 17, g: 17, b: 17 } } })
      .composite(composites)
      .jpeg({ quality: 82 })
      .toFile(file);
    console.log("wrote", file, `(${slice.length} moments: ${slice[0].moment}–${slice[slice.length - 1].moment})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
