"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useIntelAccess } from "@/lib/event-intel/use-intel-access";
import type { ShareContact, ShareContactsResult } from "@/lib/event-intel/share-contacts";

/**
 * Suggested recipients under the share email's Recipients box: the calendar
 * contact, the client's past recipients, and anyone this gallery already went
 * to (`/api/events/[eventId]/share-contacts`, Event Intel accounts only).
 *
 * A chip ADDS an address when clicked and never fills the box on its own: a
 * wrong guess there is an email to the wrong person. The lookup reads the
 * calendar and can take a few seconds, so the box is usable the whole time and
 * the chips arrive when they arrive.
 */

const SOURCE_LABEL: Record<ShareContact["source"], string> = {
  calendar: "Calendar",
  client: "Past recipient",
  sent: "Sent",
};

export function parseRecipients(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.includes("@"));
}

export function RecipientSuggestions({
  eventId,
  recipients,
  onAdd,
}: {
  eventId: string;
  recipients: string;
  onAdd: (email: string) => void;
}) {
  const hasIntel = useIntelAccess() === true;
  const [result, setResult] = useState<ShareContactsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasIntel) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/events/${eventId}/share-contacts`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ShareContactsResult>) : null))
      .then((data) => { if (!cancelled) setResult(data); })
      .catch(() => { if (!cancelled) setResult(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, hasIntel]);

  const added = useMemo(() => new Set(parseRecipients(recipients)), [recipients]);

  if (!hasIntel) return null;
  if (loading) {
    return <p className="text-[11px] text-stone-400 mt-2 animate-pulse">Looking up contacts…</p>;
  }
  const contacts = result?.contacts ?? [];
  if (!contacts.length) {
    // Say why there is nothing only when it is something to act on; an
    // unlinked gallery with no history is simply quiet.
    return result?.calendar === "unavailable" ? (
      <p className="text-[11px] text-stone-400 mt-2">Couldn&rsquo;t read the calendar for contact suggestions.</p>
    ) : null;
  }

  return (
    <div className="mt-3">
      <p className="label-caps text-stone-400 mb-1.5">Suggested</p>
      <div className="flex flex-wrap gap-1.5">
        {contacts.map((c) => {
          const isAdded = added.has(c.email);
          return (
            <button
              key={c.email}
              type="button"
              disabled={isAdded}
              onClick={() => onAdd(c.email)}
              title={c.detail}
              aria-label={isAdded ? `${c.email} added` : `Add ${c.email} (${c.detail})`}
              className={`group inline-flex items-center gap-1.5 border px-2.5 py-1 text-[12px] transition-colors pointer-coarse:py-2 ${
                isAdded
                  ? "border-stone-200 text-stone-400 cursor-default"
                  : "border-stone-200 text-stone-700 hover:border-stone-900 hover:text-stone-900"
              }`}
            >
              {isAdded ? (
                <Check size={12} className="text-emerald-500 shrink-0" />
              ) : (
                <Plus size={12} className="text-stone-400 group-hover:text-stone-900 shrink-0" />
              )}
              <span className="break-all text-left">{c.email}</span>
              <span className="text-[10px] uppercase tracking-wider text-stone-400">{SOURCE_LABEL[c.source]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
