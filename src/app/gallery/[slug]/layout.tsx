import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

/**
 * Public gallery metadata — sets a clean tab title and an open-graph
 * preview based on the event name + photographer business name.
 *
 * For password-protected shares we deliberately return a generic title
 * matching the OG image gate so link-preview bots can't surface the
 * event name pre-authentication.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const supabase = createServiceClient();
    const { data: share } = await supabase
      .from("shares")
      .select("event_id, password_hash, is_active")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return { title: "Gallery" };
    }

    if (share.password_hash) {
      // Mirror the OG image gate — don't reveal the event name on a
      // share that hasn't been unlocked.
      return { title: "Private Gallery" };
    }

    const { data: event } = await supabase
      .from("events")
      .select("name, user_id")
      .eq("id", share.event_id)
      .single();

    if (!event) return { title: "Gallery" };

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("business_name")
      .eq("user_id", event.user_id)
      .single();

    const businessName = profile?.business_name;
    const title = businessName
      ? `${event.name} — ${businessName}`
      : event.name;

    return {
      title,
      openGraph: {
        title,
        type: "website",
      },
    };
  } catch {
    return { title: "Gallery" };
  }
}

export default function GalleryLayout({ children }: Props) {
  return children;
}
