"use client";

import { use } from "react";
import { GalleryExperience } from "@/components/gallery/GalleryExperience";

/**
 * The photographer's preview — literally the guest gallery, pointed at their
 * own event instead of a share slug.
 *
 * This file used to be a 609-line reimplementation, and it had drifted:
 * filename-only search, no selfie search, no stack/section parity guarantee.
 * A preview that isn't the real thing is worse than no preview, because it
 * answers "is this what my client sees?" with a confident wrong yes.
 */
export default function GalleryPreviewPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  return <GalleryExperience source={{ kind: "preview", eventId }} />;
}
