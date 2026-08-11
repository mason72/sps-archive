"use client";

import { use } from "react";
import { GalleryExperience } from "@/components/gallery/GalleryExperience";

/**
 * The guest gallery. All of it lives in GalleryExperience, which the owner's
 * preview renders too — see that file for why they must not be two copies.
 */
export default function GalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <GalleryExperience source={{ kind: "share", slug }} />;
}
