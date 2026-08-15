import { getAuthUser } from "@/lib/auth/helpers";
import { hasIntelAccess } from "@/lib/event-intel/access";
import { AppNav, type AppNavProps } from "./AppNav";

/**
 * AppNav with the admin flag resolved server-side.
 *
 * The flag used to be passed only by the dashboard — the one page that already
 * had it — so Ops silently vanished from every other page after the nav was
 * unified. A nav item that appears on one screen and not the next reads as a
 * bug, because it is one.
 *
 * Reads the REAL session's is_admin, never the act-as identity: an admin acting
 * as the team account keeps ops access, and the team account can never borrow
 * it. /ops re-gates on every page regardless — this decides what is OFFERED,
 * never what is allowed.
 */
export async function AppNavServer(props: Omit<AppNavProps, "isAdmin" | "hasIntel">) {
  const { user, realUser, supabase } = await getAuthUser();
  let isAdmin = false;
  if (realUser) {
    const { data } = await supabase
      .from("user_profiles")
      .select("is_admin")
      .eq("user_id", realUser.id)
      .single();
    isAdmin = !!data?.is_admin;
  }
  /**
   * Intel follows the EFFECTIVE user, where Ops follows the REAL one — and the
   * difference is not an oversight.
   *
   * Ops is a POWER, so act-as must never lend it: an admin browsing as someone
   * else keeps his own, and that someone can never borrow it. Intel is DATA —
   * this account's crew, venues and clients — so it belongs to whichever
   * archive you are looking at. Acting as the team account shows the team
   * account's roster, exactly as it already shows their events. Same reasoning
   * the SPS pull route gives for allowing an import under act-as.
   *
   * It matters concretely here: is_admin is mason@'s and every crew, venue and
   * event row is info@'s, so the two flags genuinely do not travel together.
   */
  return (
    <AppNav {...props} isAdmin={isAdmin} hasIntel={hasIntelAccess(user?.id)} />
  );
}
