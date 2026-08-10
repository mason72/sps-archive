/**
 * Send (or re-send) the branded alpha invite from the command line — same
 * shared template the /ops invite panel uses (src/lib/emails/invite.ts).
 * Does NOT touch allowed_signups; whitelist first (via /ops or SQL).
 *
 *   npx tsx scripts/send-invite.ts someone@example.com
 *
 * .env.local's NEXT_PUBLIC_APP_URL points at localhost — the signup link is
 * forced to production here so an emailed button never opens a dev server.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
process.env.NEXT_PUBLIC_APP_URL = "https://app.pixeltrunk.com";

async function main() {
  const to = process.argv[2];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to ?? "")) {
    throw new Error("usage: npx tsx scripts/send-invite.ts <email>");
  }
  const { sendInviteEmail } = await import("../src/lib/emails/invite");
  const ok = await sendInviteEmail(to);
  if (!ok) throw new Error("Resend rejected the send — check RESEND_API_KEY / system_errors");
  console.log(`invite sent to ${to} (signup: ${process.env.NEXT_PUBLIC_APP_URL}/signup)`);
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
