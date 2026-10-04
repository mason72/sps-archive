/**
 * The title and caption over an import's own page (`/events/import`, the
 * "running" stage), from the job's status.
 *
 * The page was written for an import in flight and said "Pulling camera
 * files … it keeps going" over every job, including one that finished weeks
 * ago. That was invisible until the event list began linking to finished
 * imports ("Import details", 2026-10-04). It also never said WHICH event it
 * was, which matters once you can arrive from a list of seventeen.
 *
 * Pure, and free of server imports: the page is a client component.
 */
export interface ImportHeading {
  title: string;
  caption: string;
}

export function importHeading(input: {
  /** The job's status, or null before anything is known about it. */
  status: string | null;
  /** The event's name on SimplePhotoShare. */
  name: string | null;
  /** When it finished, already formatted for a person ("Oct 4, 2026"). */
  finishedOn: string | null;
}): ImportHeading {
  const name = input.name?.trim() || null;

  if (input.status === "completed") {
    const parts = [name, input.finishedOn ? `finished ${input.finishedOn}` : null].filter(Boolean);
    return {
      title: "Import finished",
      caption: parts.length ? parts.join(" · ") : "The camera files are in the archive.",
    };
  }

  // "failed" resumes exactly as a stop does, and nothing a person can act on
  // differs between them.
  if (input.status === "cancelled" || input.status === "failed") {
    return { title: "Import stopped", caption: name ?? "" };
  }

  // Queued, running, or not heard from yet: an import that was just started.
  return {
    title: "Pulling camera files",
    caption: "Files are copied a page at a time. You can leave this screen and it keeps going.",
  };
}

/** Is there nothing left for this job to do? Decides "Loading…" vs "Starting…". */
export function isSettledStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
