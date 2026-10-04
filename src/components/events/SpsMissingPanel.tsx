"use client";

import { Check, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Recovered } from "@/lib/sps-integration/pull-recovered";
import { cn } from "@/lib/utils";

export type SpsRecovered = Recovered;

/** One photo a finished SPS import does not have (`sps_pull_jobs.missing`). */
export interface SpsMissingPhoto {
  spsImageId: string;
  filename: string;
  reason: string;
  /** SPS no longer lists it: nothing left to fetch. */
  gone?: boolean;
}

/** Names listed before "and N more". */
const SHOWN = 12;

const photos = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;

/**
 * What an SPS import left behind, and the way back for it.
 *
 * The list is the import's own closing check (each photo it failed on, tried
 * once more and then looked up in the gallery), stored on the job. Retry
 * fetches exactly these and nothing else. Three states, and the third matters as much
 * as the first: `null` means the import was never checked and renders nothing,
 * while an EMPTY list is a result and says so. A finished import with no line
 * at all would read the same as one nobody checked.
 *
 * Under it, what the import went back for and got: `recovered`, grouped by
 * the section each photo is filed in. A retried photo is filed beside its
 * person, not in a visible "Unsorted" tab, so without this line it is correct
 * and unfindable.
 *
 * Amber as ink, not red and not the accent: severity is its own ramp here and
 * emerald means state. White surface, hairlines, the house primary button.
 * Fixture: /dev/sps-missing.
 */
export function SpsMissingPanel({
  missing,
  recovered = null,
  status,
  retrying,
  onRetry,
}: {
  missing: SpsMissingPhoto[] | null;
  /** Photos fetched after the walk, by where they are filed now. */
  recovered?: SpsRecovered | null;
  status: string;
  /** The retry request is in flight (the button was just pressed). */
  retrying: boolean;
  onRetry: () => void;
}) {
  if (missing === null) return null;
  const filed =
    status === "completed" && recovered && recovered.total > 0 ? recovered : null;

  const live = status === "running" || status === "queued";
  const retryable = missing.filter((m) => !m.gone);
  // One reason shared by every photo is said once, under the list, rather
  // than repeated on each row (a database outage fails them all the same way).
  const reasons = new Set(missing.map((m) => m.reason));
  const sharedReason =
    missing.length > 1 && reasons.size === 1 ? missing[0].reason : null;

  if (missing.length === 0) {
    if (status !== "completed") return null;
    return (
      <>
        {/* Top-aligned with a fixed-size mark: with the count added the line
            wraps on a phone, and a centred, shrinking check drifts. */}
        <p
          className={cn(
            "flex items-start gap-2 text-[13px] leading-[1.5] text-stone-500",
            filed ? "mb-4" : "mb-8"
          )}
        >
          <Check size={13} className="mt-[3px] shrink-0 text-accent" />
          <span>
            The import brought every photo over.
            {filed && ` ${filed.total.toLocaleString()} needed a second try.`}
          </span>
        </p>
        {filed && <SpsRecoveredList recovered={filed} underCheck />}
      </>
    );
  }

  return (
    <>
      <div className={cn("border border-stone-200 bg-white p-5", filed ? "mb-4" : "mb-8")}>
        {/* The label carries the severity, as ink plus one small mark. Spelled
            out rather than `label-caps`, whose own grey wins over a colour. */}
        <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.25em] text-amber-700">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-amber-600",
              live && "animate-pulse"
            )}
          />
          {live ? "Retrying" : "Did not come over"}
        </p>
        <p className="mb-4 max-w-lg text-[14px] leading-[1.6] text-stone-700">
          {live
            ? `Fetching ${photos(retryable.length)} from SimplePhotoShare again.`
            : `${missing.length === 1 ? "This photo is" : `These ${photos(missing.length)} are`} not in this gallery. Everything else is here.`}
        </p>
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {missing.slice(0, SHOWN).map((m) => (
            <li
              key={m.spsImageId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[13px]"
            >
              <span className="break-all text-stone-900">{m.filename}</span>
              {m.reason && !sharedReason ? (
                <span className="text-[12px] text-stone-400">{m.reason}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {missing.length > SHOWN && (
          <p className="border-t border-stone-100 pt-2 text-[12px] text-stone-400">
            and {(missing.length - SHOWN).toLocaleString()} more
          </p>
        )}
        {sharedReason && (
          <p className="border-t border-stone-100 pt-2 text-[12px] text-stone-400">
            {sharedReason}
          </p>
        )}
        {/* Only on a FINISHED import. A stopped one resumes from the event list,
            and the retry route would answer "resume it instead". */}
        {status === "completed" && retryable.length > 0 && (
          <Button
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="mt-5"
          >
            {retrying ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCw size={12} />
            )}
            Retry {photos(retryable.length)}
          </Button>
        )}
      </div>
      {filed && <SpsRecoveredList recovered={filed} />}
    </>
  );
}

/**
 * The photos a retry brought over, under the section each is filed in.
 *
 * "Filed in" is said once per section, as the heading its filenames sit
 * under, not repeated on every row. Quiet on purpose: this is a record of
 * something that went right, so it carries no colour and no card.
 */
function SpsRecoveredList({
  recovered,
  underCheck = false,
}: {
  recovered: SpsRecovered;
  /** Sits under the "brought every photo over" line, which has already said
   *  how many; indented to that line's text, past its check mark. */
  underCheck?: boolean;
}) {
  const shown = recovered.groups.reduce((n, g) => n + g.filenames.length, 0);
  return (
    <div className={cn("mb-8", underCheck && "pl-[21px]")}>
      {!underCheck && (
        <p className="mb-3 max-w-lg text-[13px] leading-[1.6] text-stone-500">
          {recovered.total === 1
            ? "1 photo needed a second try and is in the gallery now."
            : `${photos(recovered.total)} needed a second try and are in the gallery now.`}
        </p>
      )}
      <div className="space-y-3">
        {/* Index keys: two sections can share a name, two photos a filename. */}
        {recovered.groups.map((group, g) => (
          <div key={g}>
            <p className="flex items-baseline gap-2 text-[13px] text-stone-900">
              {group.section ? (
                <>
                  <span className="text-stone-400">Filed in</span>
                  <span className="font-medium">{group.section}</span>
                </>
              ) : (
                <span className="font-medium text-amber-700">Not in a section</span>
              )}
              {recovered.groups.length > 1 && (
                <span className="text-[12px] tabular-nums text-stone-400">
                  {group.count.toLocaleString()}
                </span>
              )}
            </p>
            {group.filenames.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {group.filenames.map((name, n) => (
                  <li key={n} className="break-all text-[12px] text-stone-500">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {recovered.total > shown && (
        <p className="mt-3 text-[12px] text-stone-400">
          and {(recovered.total - shown).toLocaleString()} more
        </p>
      )}
    </div>
  );
}
