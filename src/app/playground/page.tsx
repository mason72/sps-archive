import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import { PlaygroundClient } from "./PlaygroundClient";

const EVENT_ID = "961e7879-0dc4-4f74-a655-628ceebb2683";

export const metadata = {
  title: "Pixeltrunk — Style Playground",
};

export default async function PlaygroundPage() {
  const supabase = createServiceClient();

  // Fetch 8 images from the Tester event
  const { data: rawImages } = await supabase
    .from("images")
    .select("id, r2_key, original_filename, width, height")
    .eq("event_id", EVENT_ID)
    .order("created_at", { ascending: true })
    .limit(8);

  // Generate presigned URLs from originals
  const images = await Promise.all(
    (rawImages || []).map(async (img) => {
      const url = await getPresignedDownloadUrl(img.r2_key, 14400);
      return {
        id: img.id,
        url,
        width: img.width || 400,
        height: img.height || 600,
      };
    })
  );

  return <PlaygroundClient images={images} />;
}
