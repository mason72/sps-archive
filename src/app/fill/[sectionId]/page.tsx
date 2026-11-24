"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { FillJob, fillApi } from "@/components/fill/FillJob";

/** /fill/[sectionId] — the crew's pick page for one TDP Work job. */
export default function FillJobPage() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const api = useMemo(() => fillApi(sectionId), [sectionId]);
  return <FillJob api={api} />;
}
