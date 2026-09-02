/**
 * Scratch: prove the warm-ping payload (a flat 64px JPEG) is accepted by the
 * Modal selfie endpoint, and measure a cold call against the warm one right
 * after it. Same request `warmFaceDetector` sends, minus the usage row.
 *
 *   npx tsx scripts/triage/selfie-warm-probe.ts
 *
 * Reads .env.local by hand (same as timeout-probe.ts): zsh cannot `source`
 * it, and the secret must reach the process via env, never argv.
 */
import fs from "node:fs";
import sharp from "sharp";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

async function once(label: string) {
  const frame = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#7f7f7f" },
  })
    .jpeg()
    .toBuffer();
  const t = Date.now();
  const res = await fetch(process.env.MODAL_AI_SELFIE_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY,
      image_b64: frame.toString("base64"),
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await res.text();
  console.log(label, res.status, ((Date.now() - t) / 1000).toFixed(1) + "s", body.slice(0, 60));
}

(async () => {
  await once("first ");
  await once("second");
})();
