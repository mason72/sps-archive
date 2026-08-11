"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { formatFileSize } from "@/lib/utils";

/**
 * Attach the SPS analytics spreadsheet to this event and decide whether the
 * publish email carries a link to it.
 *
 * The one awkward fact this whole component is shaped around: **the download
 * token is returned exactly once.** Only its SHA-256 is stored, so nothing —
 * not this component, not the send route, not Mason with database access —
 * can read it back. Consequences, all of them visible in the UI:
 *
 *  - a fresh upload puts the token in memory and the email can carry it;
 *  - a sheet attached in an EARLIER session shows as attached but with no
 *    link in hand, so the only honest options are "new link" or "re-upload";
 *  - both of those kill every link already sent, and the UI says so before
 *    the click rather than after.
 *
 * The sheet is PII (guest names, emails, sign-in answers). It appears on no
 * gallery surface — this composer and the email are the entire path.
 */

interface GuestListMetaView {
  filename: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
}

export interface GuestListSelection {
  /** Live token, or null when nothing should be attached to this email. */
  token: string | null;
  message: string;
}

interface Props {
  eventId: string;
  /**
   * What the parent is already holding. This component unmounts whenever the
   * composer steps back to template selection, and a token cannot be fetched
   * again — losing it on a stray click would silently force a re-upload.
   */
  initial?: GuestListSelection;
  onChange: (selection: GuestListSelection) => void;
}

const DEFAULT_MESSAGE = "The guest list from the event is attached below.";

export function GuestListAttachment({ eventId, initial, onChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "upload" | "rotate" | "revoke">(null);
  const [meta, setMeta] = useState<GuestListMetaView | null>(null);
  /** Present only for a sheet attached in THIS session — see `initial`. */
  const [token, setToken] = useState<string | null>(initial?.token ?? null);
  const [include, setInclude] = useState(true);
  const [message, setMessage] = useState(initial?.message || DEFAULT_MESSAGE);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Report upward whenever the effective choice changes. A token we don't
  // have, or a box that isn't ticked, both mean "send nothing".
  useEffect(() => {
    onChange({ token: include ? token : null, message });
  }, [token, include, message, onChange]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/guest-list`);
        if (res.ok) {
          const data = await res.json();
          if (data.attached) {
            setMeta({
              filename: data.filename,
              sizeBytes: data.sizeBytes,
              uploadedAt: data.uploadedAt,
            });
          }
        }
      } catch {
        // Non-fatal: the composer still works, just without the attachment.
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  const upload = useCallback(
    async (file: File) => {
      setBusy("upload");
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/events/${eventId}/guest-list`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setToken(data.token);
        setInclude(true);
        setMeta({
          filename: data.filename,
          sizeBytes: data.sizeBytes,
          uploadedAt: new Date().toISOString(),
        });
        toast.success("Guest list attached");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [eventId]
  );

  const rotate = useCallback(async () => {
    if (
      !window.confirm(
        "Create a new download link?\n\nAny link you have already emailed for this guest list will stop working immediately."
      )
    )
      return;
    setBusy("rotate");
    try {
      const res = await fetch(`/api/events/${eventId}/guest-list`, {
        method: "PATCH",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create a new link");
      setToken(data.token);
      setInclude(true);
      toast.success("New link ready — older links are now dead");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create a link");
    } finally {
      setBusy(null);
    }
  }, [eventId]);

  const revoke = useCallback(async () => {
    if (
      !window.confirm(
        "Remove the guest list?\n\nEvery link already emailed for it stops working immediately."
      )
    )
      return;
    setBusy("revoke");
    try {
      const res = await fetch(`/api/events/${eventId}/guest-list`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Revoke failed");
      setMeta(null);
      setToken(null);
      toast.success("Guest list removed");
    } catch {
      toast.error("Could not remove the guest list");
    } finally {
      setBusy(null);
    }
  }, [eventId]);

  const copyLink = useCallback(() => {
    if (!token) return;
    navigator.clipboard.writeText(
      `${window.location.origin}/api/guest-list/${token}`
    );
    setCopied(true);
    toast.success("Download link copied");
    setTimeout(() => setCopied(false), 2000);
  }, [token]);

  if (loading) return null;

  return (
    <div className="border border-stone-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={13} className="text-stone-400 shrink-0" />
            <span className="text-[13px] text-stone-700">Guest list</span>
          </div>
          <p className="text-[11px] text-stone-400 mt-1 leading-relaxed">
            {meta
              ? "Sent only to the people you email here — it never appears in the gallery."
              : "Attach the spreadsheet from SPS → Analytics → Create Spreadsheet."}
          </p>
        </div>

        {meta && token && (
          <button
            type="button"
            onClick={() => setInclude((v) => !v)}
            role="switch"
            aria-checked={include}
            aria-label="Include the guest list link in this email"
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
              include ? "bg-emerald-500" : "bg-stone-200"
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                include ? "translate-x-4" : ""
              }`}
            />
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv,.tsv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {!meta ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy === "upload"}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-all disabled:opacity-40"
        >
          {busy === "upload" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Upload size={12} />
          )}
          {busy === "upload" ? "Uploading…" : "Attach spreadsheet"}
        </button>
      ) : (
        <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">
          {/* What's attached */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] text-stone-900 truncate">
              {meta.filename}
            </span>
            <span className="text-[11px] text-stone-400 shrink-0">
              {meta.sizeBytes ? formatFileSize(meta.sizeBytes) : ""}
              {meta.uploadedAt
                ? ` · ${new Date(meta.uploadedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`
                : ""}
            </span>
          </div>

          {token ? (
            <>
              {/* The link exists only in this tab, so say so plainly and give
                  them a copy of it before it's gone. */}
              <div className="flex items-center gap-2 text-[11px] text-emerald-700">
                <Check size={12} className="shrink-0" />
                <span>Link ready for this email</span>
                <button
                  type="button"
                  onClick={copyLink}
                  className="ml-auto inline-flex items-center gap-1 text-stone-500 hover:text-stone-900 transition-colors"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>

              {include && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] text-stone-400 mb-1.5 block">
                    Message above the link
                  </label>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={300}
                    placeholder="Optional — leave blank for just the link"
                    className="w-full text-[13px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-1.5 transition-colors"
                  />
                </div>
              )}
            </>
          ) : (
            /* Attached previously — the token is gone for good. */
            <p className="text-[11px] text-stone-500 leading-relaxed">
              This sheet was attached in an earlier session, so the download
              link isn&rsquo;t recoverable — only its fingerprint is stored.
              Create a new link to include it here.
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={rotate}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-40"
            >
              {busy === "rotate" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              New link
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-40"
            >
              {busy === "upload" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Upload size={11} />
              )}
              Replace
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-red-600 transition-colors ml-auto disabled:opacity-40"
            >
              {busy === "revoke" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Trash2 size={11} />
              )}
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
