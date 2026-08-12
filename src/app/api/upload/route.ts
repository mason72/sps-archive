import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  buildImageKey,
  getPresignedUploadUrl,
} from "@/lib/r2/client";
import { parseFilename } from "@/lib/upload/parse-filename";
import { mediaTypeForMime, validateUploadFile } from "@/lib/upload/media";
import { reportSystemError } from "@/lib/monitoring/report";
import { INTAKE_SECTION_NAME } from "@/lib/sections/intake";

/**
 * POST /api/upload
 *
 * Accepts file metadata, creates DB records, returns image IDs.
 * The actual file binary is uploaded via PUT /api/upload/[imageId].
 */
export async function POST(request: NextRequest) {
  let eventIdForReport: string | undefined;
  let fileCountForReport: number | undefined;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, sectionId, files, skipSection } = body as {
      eventId: string;
      sectionId?: string;
      files: { name: string; type: string; size: number }[];
      /**
       * Cover-image uploads set this: the image is stored for use as the gallery
       * cover ONLY and must NOT join a section (so it never shows in the grid /
       * "All Images"). Deliberately bypasses the no-orphans invariant below —
       * a cover is not a gallery image.
       */
      skipSection?: boolean;
    };

    eventIdForReport = eventId;
    fileCountForReport = files?.length;

    if (!eventId || !files?.length) {
      return NextResponse.json(
        { error: "eventId and files are required" },
        { status: 400 }
      );
    }

    // Cap the batch — the client already chunks by 50 (PRESIGN_CHUNK); a much
    // larger single call would mint that many DB rows + presigns at once.
    if (files.length > 200) {
      return NextResponse.json(
        { error: "Too many files in one request (max 200)" },
        { status: 400 }
      );
    }

    // Server-side guard on format + size (the dropzone enforces the same
    // rules client-side; this catches anything that bypasses it).
    for (const file of files) {
      const problem = validateUploadFile(file);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    // Verify event exists AND belongs to the caller. The service client
    // bypasses RLS, so an existence-only check let any logged-in user inject
    // images + sections into any tenant's event (lessons #2/#14).
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Target section (when given) must belong to the same owned event — never
    // trust a client-supplied sectionId to point at the caller's own event.
    if (sectionId && !skipSection) {
      const { data: target } = await supabase
        .from("sections")
        .select("name, locked, event_id")
        .eq("id", sectionId)
        .maybeSingle();
      if (!target || target.event_id !== eventId) {
        return NextResponse.json(
          { error: "Section not found" },
          { status: 404 }
        );
      }
      if (target.locked) {
        return NextResponse.json(
          { error: `"${target.name}" is locked — unlock it to upload here.` },
          { status: 423 }
        );
      }
    }

    // INVARIANT: every image must belong to a real section — no orphans, ever.
    // "All Photos" is a derived view, not an upload target. When no section is
    // specified, the default target is the "Unsorted" INTAKE (created on
    // demand) — NEVER Highlights, which is reserved for the curated best-of.
    // (Cover uploads opt out via skipSection — they are not gallery images.)
    let targetSectionId = sectionId;
    if (!skipSection && !targetSectionId) {
      const { data: intake } = await supabase
        .from("sections")
        .select("id")
        .eq("event_id", eventId)
        .ilike("name", INTAKE_SECTION_NAME)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (intake) {
        targetSectionId = intake.id;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("sections")
          .insert({
            event_id: eventId,
            name: INTAKE_SECTION_NAME,
            sort_order: 0,
            is_auto: false,
          })
          .select("id")
          .single();
        if (createErr || !created) {
          throw createErr || new Error("Failed to create default section");
        }
        targetSectionId = created.id;
      }
    }

    if (!skipSection && !targetSectionId) {
      throw new Error("Could not resolve a target section for upload");
    }

    // ── Duplicate guard ──────────────────────────────────────────────────
    // Nothing used to stop the same folder being uploaded twice: every presign
    // minted a fresh UUID key, so re-dragging a directory created a complete
    // second copy — rows, R2 objects, thumbnails, and a second pass of GPU
    // indexing. Hotel Data Conference 2026 ended up 34% duplicates (1,945
    // extra rows) that way, purely from re-trying after a failed upload.
    //
    // Identity is (event, original_filename, file_size). Same name AND same
    // bytes is the same photo; same name with a DIFFERENT size is a re-export
    // the photographer actually made, and must still upload. Matching only
    // against SETTLED rows means a failed or in-flight upload can always be
    // retried — which is the exact flow that created the mess.
    // The guard has to know WHICH SECTION it is protecting, not just the event.
    // Event-scoped skipping silently dropped files the photographer was
    // deliberately placing somewhere new: Justin put 78 photos in Highlights and
    // the same files inside 1,143 going to Unsorted, and the second batch
    // vanished without a word (verified: the event held 1,142 rows and no
    // Highlights copies). Section membership is a LINK table — one image can
    // belong to several sections — so "already in this event, but not in the
    // section you are pointing at" is a request to LINK, never to skip.
    //
    // Three outcomes now, and each is reported separately because they mean
    // different things to the person watching:
    //   fresh      → upload it
    //   linkable   → already here, add it to this section (no bytes move)
    //   duplicate  → already in THIS section; genuinely nothing to do
    const existingByKey = new Map<string, string>();
    {
      const names = [...new Set(files.map((f) => f.name))];
      // Chunked: a folder drop can be thousands of names, and PostgREST has to
      // fit them in a URL.
      for (let i = 0; i < names.length; i += 200) {
        const { data: existing, error: dupErr } = await supabase
          .from("images")
          .select("id, original_filename, file_size")
          .eq("event_id", eventId)
          .eq("processing_status", "complete")
          .in("original_filename", names.slice(i, i + 200));
        if (dupErr) throw dupErr;
        for (const row of (existing ?? []) as {
          id: string;
          original_filename: string;
          file_size: number | null;
        }[]) {
          if (row.file_size != null) {
            existingByKey.set(`${row.original_filename}|${row.file_size}`, row.id);
          }
        }
      }
    }

    // Which of those are already IN the target section? Only those are true
    // no-ops. (A cover upload has no section, so nothing is linkable.)
    const alreadyInSection = new Set<string>();
    if (targetSectionId && existingByKey.size > 0) {
      const ids = [...existingByKey.values()];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: linked, error: linkErr } = await supabase
          .from("section_images")
          .select("image_id")
          .eq("section_id", targetSectionId)
          .in("image_id", ids.slice(i, i + 200));
        if (linkErr) throw linkErr;
        for (const row of linked ?? []) alreadyInSection.add(row.image_id);
      }
    }

    const duplicates: typeof files = [];
    const linkable: { file: (typeof files)[number]; imageId: string }[] = [];
    const fresh: typeof files = [];
    for (const f of files) {
      const existingId = existingByKey.get(`${f.name}|${f.size}`);
      if (!existingId) fresh.push(f);
      else if (alreadyInSection.has(existingId)) duplicates.push(f);
      else linkable.push({ file: f, imageId: existingId });
    }

    // Link the ones that just need to join this section. No bytes move, so this
    // happens here rather than costing the client a round trip per file.
    let linkedCount = 0;
    if (linkable.length && targetSectionId && !skipSection) {
      const { data: tail } = await supabase
        .from("section_images")
        .select("sort_order")
        .eq("section_id", targetSectionId)
        .order("sort_order", { ascending: false })
        .limit(1);
      let nextSort = (tail?.[0]?.sort_order ?? -1) + 1;
      const { error: linkInsertErr } = await supabase
        .from("section_images")
        .insert(
          linkable.map((l) => ({
            section_id: targetSectionId,
            image_id: l.imageId,
            sort_order: nextSort++,
          }))
        );
      // Non-fatal: a failed link must not fail the upload of everything else.
      if (linkInsertErr) {
        console.error("Section link for existing images failed:", linkInsertErr);
        await reportSystemError("upload.link-existing", linkInsertErr, {
          eventId,
          sectionId: targetSectionId,
          count: linkable.length,
        });
      } else {
        linkedCount = linkable.length;
      }
    }

    // Everything in this batch is already here. Answer honestly rather than
    // returning an empty upload list the client would read as a failure.
    if (fresh.length === 0) {
      return NextResponse.json({
        uploads: [],
        duplicatesSkipped: duplicates.length,
        duplicateKeys: duplicates.map((f) => `${f.name}|${f.size}`),
        linkedToSection: linkedCount,
        linkedKeys: linkable.map((l) => `${l.file.name}|${l.file.size}`),
      });
    }

    // Build all records
    const records = fresh.map((file) => {
      const id = randomUUID();
      const parsed = parseFilename(file.name);
      const uniqueFilename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(eventId, uniqueFilename);
      return { id, parsed, uniqueFilename, r2Key, file };
    });

    // Batch insert all image records
    const { error: insertError } = await supabase.from("images").insert(
      records.map((r) => ({
        id: r.id,
        event_id: eventId,
        filename: r.uniqueFilename,
        original_filename: r.file.name,
        r2_key: r.r2Key,
        file_size: r.file.size,
        mime_type: r.file.type,
        media_type: mediaTypeForMime(r.file.type),
        parsed_name: r.parsed.name,
        processing_status: "pending",
      }))
    );

    if (insertError) throw insertError;

    // Link every image to the resolved section. If this fails, roll back the
    // image rows we just inserted so we never leave orphaned images behind.
    // Cover uploads (skipSection) intentionally create no link.
    if (!skipSection && targetSectionId) {
      const sectionIdForLinks = targetSectionId;
      const { error: linkError } = await supabase.from("section_images").insert(
        records.map((r, i) => ({
          section_id: sectionIdForLinks,
          image_id: r.id,
          sort_order: i,
        }))
      );
      if (linkError) {
        await supabase
          .from("images")
          .delete()
          .in(
            "id",
            records.map((r) => r.id)
          );
        throw linkError;
      }
    }

    // Generate presigned upload URLs so the browser uploads directly to R2
    // (bypasses the ~4.5MB Vercel request body limit). 4h expiry: URLs are
    // minted 50 at a time up front but drain 12 at a time, so in a multi-
    // thousand-file session a task can sit in the queue well past 1h — an
    // expired URL then fails the PUT with a 403 (the eBay HEADSHOTS incident).
    const uploads = await Promise.all(
      records.map(async (r) => ({
        imageId: r.id,
        r2Key: r.r2Key,
        uploadUrl: await getPresignedUploadUrl(r.r2Key, r.file.type, 14400),
        originalFilename: r.file.name,
        parsedName: r.parsed.name,
      }))
    );

    return NextResponse.json({
      uploads,
      sectionId: targetSectionId,
      // The client reports these so a skip never looks like a silent failure.
      duplicatesSkipped: duplicates.length,
      // name|size for every skip, so the client can mark exactly those entries
      // rather than inferring from a short uploads array — which its own guard
      // would otherwise read as server failures.
      duplicateKeys: duplicates.map((f) => `${f.name}|${f.size}`),
      // Already in the event but NOT in this section, so we linked them here
      // instead of dropping them. Reported separately from duplicates because
      // "added to this section" and "nothing to do" are different answers.
      linkedToSection: linkedCount,
      linkedKeys: linkable.map((l) => `${l.file.name}|${l.file.size}`),
    });
  } catch (error) {
    console.error("Upload error:", error);
    await reportSystemError("upload.presign", error, { eventId: eventIdForReport, fileCount: fileCountForReport });
    return NextResponse.json(
      { error: "Failed to prepare upload" },
      { status: 500 }
    );
  }
}
