import { notFound, redirect } from "next/navigation";
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

/**
 * Page-level admin gate. MUST be awaited at the top of EVERY /ops page,
 * before any data is fetched — a layout gate alone is not a security
 * boundary: streaming SSR renders page and layout in parallel, so page data
 * lands in the raw response stream even when the layout redirects/404s
 * (leak caught by curl 2026-08-10, invisible in a browser).
 */
export async function assertAdminPage(): Promise<void> {
  const { user } = await getAuthUser();
  if (!user) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    redirect(`${appUrl}/login?redirect=/ops`);
  }
  const admin = await requireAdmin();
  if (!admin) notFound();
}
