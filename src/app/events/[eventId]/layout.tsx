import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ eventId: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;

  try {
    const supabase = createServiceClient();
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
