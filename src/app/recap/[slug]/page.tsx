"use client";

import { use } from "react";
import { RecapExperience } from "@/components/recap/RecapExperience";

/**
 * The delivery recap a client forwards: what their guests received and how
 * fast, with the photographer's brand and theirs. Share-gated like the
 * gallery it belongs to (same slug, same password, same expiry).
 */
export default function RecapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <RecapExperience slug={slug} />;
}
