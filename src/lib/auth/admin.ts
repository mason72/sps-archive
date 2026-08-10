import { getAuthUser } from "@/lib/auth/helpers";
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * Admin gate for /ops and /api/ops — THE one place is_admin is checked.
 *
 * Returns null unless the caller is authenticated AND user_profiles.is_admin.
 * Note getAuthUser() hands back the SERVICE client (RLS bypass) — that's the
 * point here (ops reads cross-tenant), which is exactly why this gate must
 * fail closed and why every /api/ops route calls it first.
 */
export async function requireAdmin(): Promise<{
  user: { id: string; email?: string };
  supabase: SupabaseDB;
} | null> {
  const { user, supabase, error } = await getAuthUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .single();
  if (profileError || !profile?.is_admin) return null;

  return { user: { id: user.id, email: user.email ?? undefined }, supabase };
}
