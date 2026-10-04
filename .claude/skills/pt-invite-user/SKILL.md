---
name: pt-invite-user
description: Invite someone to the Pixeltrunk alpha: whitelist the email, send the branded invite, confirm delivery, record it. Use when Mason says "invite X", "send X an invite", "add X to the whitelist", "use this for now: <email>", or approves a waitlist request.
---

# Pixeltrunk alpha invite

Four asks on 2026-08-10/11 and none had a skill; spsv2's `provision-beta-user` is a different product.
Access model is in `docs/OPS.md`: signup is invitation-only, the lock is the `allowed_signups` table,
the invite email has one home (`src/lib/emails/invite.ts`), and the signup link must point at
production.

## Steps
1. **Whitelist** the lowercase email in `allowed_signups`: through `/ops` ("approve" on a waitlist row,
   or the invite panel) when a browser is at hand; otherwise one `INSERT ... ON CONFLICT DO NOTHING`
   via `scripts/db-sql.ts` with the production env. Read it back.
2. **Send**: `npx tsx scripts/send-invite.ts <email>` (pins the signup link to
   `https://app.pixeltrunk.com`; `.env.local` points at localhost, which is why the pin exists).
   The /ops "approve" path sends the same template; do not send twice.
3. **Confirm delivery** in Resend (MCP `list-emails` filtered by the address, status delivered) and that
   `system_errors` has no new row for the send.
4. **Record**: the ops dashboard shows invites; also add the name and date to `tasks/todo.md`'s alpha
   list so the next session knows who is in.
5. When they sign up, "work as" them from /ops (`impersonation.ts`) to check their first event loads;
   admin-gated checks use `realUser`, content scopes to `user`.

## Report
Email, whitelisted (yes/already), invite sent (Resend id, delivered), where it was recorded. The
"Where it is" line is `Live: invite delivered to <email>`.
