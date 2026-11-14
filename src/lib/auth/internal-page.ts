import { assertAdminPage } from "@/lib/auth/admin";

/**
 * Gate for internal pages (/dev, /mockups): open on a developer's machine,
 * admins only everywhere else.
 *
 * Before 2026-11-14 these were reachable by any signed-in account in
 * production (and /mockups by anonymous visitors, through middleware's
 * `startsWith("/m")` marketing pass). The data on them is fake, but they show
 * TDP's Intel and calendar designs, and /dev/crew-tag replaced `window.fetch`
 * for the whole tab and never put it back, so a visit there left fake API
 * answers in place for the rest of that tab's session (pilot audit).
 */
export async function assertInternalPage(): Promise<void> {
  if (process.env.NODE_ENV === "development") return;
  await assertAdminPage();
}
