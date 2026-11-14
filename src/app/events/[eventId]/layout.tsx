import type { Metadata } from "next";
import { getAuthUser } from "@/lib/auth/helpers";

interface Props {
  params: Promise<{ eventId: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;

  try {
    // Owner-scoped: the service client skips row-level security, and this
    // title went to any signed-in account that opened /events/<another
    // account's id> (pilot audit, 2026-11-14). The effective user, so an
    // admin acting as an account sees that account's titles.
    const { user, supabase } = await getAuthUser();
    if (!user) return { title: "Event — Pixeltrunk" };
    const { data } = await supabase
      .from("events")
      .select("name")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (data?.name) {
      return { title: `${data.name} — Pixeltrunk` };
    }
  } catch {
    // Fall through to default
  }

  return { title: "Event — Pixeltrunk" };
}

export default function EventDetailLayout({ children }: Props) {
  return children;
}
