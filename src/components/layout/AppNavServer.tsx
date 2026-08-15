import { getAuthUser } from "@/lib/auth/helpers";
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
export async function AppNavServer(props: Omit<AppNavProps, "isAdmin">) {
  const { realUser, supabase } = await getAuthUser();
  let isAdmin = false;
  if (realUser) {
    const { data } = await supabase
      .from("user_profiles")
      .select("is_admin")
      .eq("user_id", realUser.id)
      .single();
    isAdmin = !!data?.is_admin;
  }
  return <AppNav {...props} isAdmin={isAdmin} />;
}
