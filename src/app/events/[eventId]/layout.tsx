import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ eventId: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;

  try {
    // Use the cookie-bound RLS client so the title isn't generated from
    // events the viewer doesn't own — would otherwise be a tiny info
    // leak ("you don't own this event but the tab title still shows
    // the wedding's name").
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("events")
      .select("name")
      .eq("id", eventId)
      .single();

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
