/**
 * Favorites digest — "your client finished picking."
 *
 * When a share's favoriting activity goes quiet for DIGEST_QUIET_HOURS, the
 * photographer gets one branded email summarizing the NEW favorites since the
 * last digest (shares.digested_at is the high-watermark). Clients favorite in
 * bursts, so quiet-period beats instant (20 emails per session) and beats a
 * daily digest (news arrives the same day they finish). A client who returns
 * later triggers a follow-up digest containing only the new picks.
 *
 * This module is the pure core: candidate selection from prefetched rows and
 * email-body construction. The Inngest cron (favoritesDigest in
 * lib/inngest/functions.ts) does the I/O around it.
 */

export const DIGEST_QUIET_HOURS = 2;
export const DIGEST_PREVIEW_COUNT = 4;

export interface FavoriteRow {
  share_id: string;
  image_id: string;
  created_at: string;
  share: {
    slug: string;
    event_id: string;
    digested_at: string | null;
  };
}

export interface DigestCandidate {
  shareId: string;
  slug: string;
  eventId: string;
  /** New favorites since the last digest, oldest first. */
  newImageIds: string[];
  /** First DIGEST_PREVIEW_COUNT of newImageIds — the email's preview strip. */
  previewImageIds: string[];
}

/**
 * Group favorite rows by share and pick the shares that are due a digest:
 * at least one favorite newer than digested_at, and NO activity at all within
 * the quiet window (the client looks done).
 */
export function selectDigestCandidates(
  rows: FavoriteRow[],
  now: Date
): DigestCandidate[] {
  const quietCutoff = now.getTime() - DIGEST_QUIET_HOURS * 60 * 60 * 1000;

  const byShare = new Map<string, FavoriteRow[]>();
  for (const row of rows) {
    const list = byShare.get(row.share_id) ?? [];
    list.push(row);
    byShare.set(row.share_id, list);
  }

  const candidates: DigestCandidate[] = [];
  for (const [shareId, favs] of byShare) {
    const { share } = favs[0];
    const digestedAt = share.digested_at
      ? new Date(share.digested_at).getTime()
      : 0;

    const newFavs = favs
      .filter((f) => new Date(f.created_at).getTime() > digestedAt)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    if (newFavs.length === 0) continue;

    // Still picking? Any favorite inside the quiet window defers the digest.
    const lastActivity = Math.max(
      ...favs.map((f) => new Date(f.created_at).getTime())
    );
    if (lastActivity > quietCutoff) continue;

    const newImageIds = newFavs.map((f) => f.image_id);
    candidates.push({
      shareId,
      slug: share.slug,
      eventId: share.event_id,
      newImageIds,
      previewImageIds: newImageIds.slice(0, DIGEST_PREVIEW_COUNT),
    });
  }
  return candidates;
}

/**
 * The email body dropped into renderEmailShell: headline, a strip of up to
 * four favorited photos (durable /fav-thumb redirects — emails outlive
 * presigns), and an "and N more" line. Table layout + inline styles for
 * email-client compatibility, matching the shell's idiom.
 */
export function buildDigestEmailBody(opts: {
  eventName: string;
  newCount: number;
  totalCount: number;
  previewUrls: string[];
  galleryUrl: string;
}): string {
  const { eventName, newCount, totalCount, previewUrls, galleryUrl } = opts;
  const more = newCount - previewUrls.length;

  const cells = previewUrls
    .map(
      (url) => `
        <td width="${Math.floor(100 / previewUrls.length)}%" style="padding:2px;">
          <a href="${galleryUrl}" style="display:block;">
            <img src="${url}" alt="" width="120"
                 style="display:block;width:100%;height:96px;object-fit:cover;border:0;background:#f5f5f4;"/>
          </a>
        </td>`
    )
    .join("");

  return `
    <p style="margin:0 0 6px;font-size:15px;">
      A client selected <strong>${newCount} favorite${newCount === 1 ? "" : "s"}</strong>
      from <strong>${escapeHtml(eventName)}</strong>${
        totalCount > newCount ? ` (${totalCount} total on this link)` : ""
      }.
    </p>
    ${
      previewUrls.length > 0
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px;">
      <tr>${cells}</tr>
    </table>`
        : ""
    }
    ${
      more > 0
        ? `<p style="margin:4px 0 0;font-size:13px;color:#78716c;">…and ${more} more.</p>`
        : ""
    }`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
