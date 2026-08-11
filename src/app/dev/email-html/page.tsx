"use client";

import { useState } from "react";
import { EmailEditor } from "@/components/email/EmailEditor";
import { EmailPreview } from "@/components/email/EmailPreview";
import { interpolateTemplate } from "@/lib/email/interpolate";
import { renderEmailShell } from "@/lib/email/shell";
import { GuestListAttachment } from "@/components/email/GuestListAttachment";

const noop = () => {};

/**
 * Email pipeline probe — the three points the body HTML passes through.
 *
 * Built 2026-08-11 to diagnose "blank lines between paragraphs don't survive
 * into the sent email". The hypothesis at the time was a sanitiser eating
 * empty `<p></p>`; there is no sanitiser anywhere in the path, so guessing
 * would have chased the wrong layer. This page shows the literal string at
 * each hand-off so the next email-rendering bug gets evidence instead:
 *
 *   1. what TipTap's `getHTML()` emits            (the editor)
 *   2. what POSTs to /api/emails/send             (after interpolation)
 *   3. what the recipient's client is handed      (renderEmailShell — the same
 *      pure module the send route calls, imported directly rather than
 *      re-implemented, so points 3 here and in prod cannot drift)
 *
 * Public because /dev is public — it holds no data of its own and reads
 * nothing from the database.
 */
export default function EmailHtmlProbe() {
  const [body, setBody] = useState(
    "<p>First paragraph.</p><p></p><p>Second paragraph, after a blank line.</p>"
  );
  const [showExtras, setShowExtras] = useState(true);
  const [guestListMessage, setGuestListMessage] = useState(
    "The guest list from the event is attached below."
  );

  const interpolated = interpolateTemplate(body, {
    event_name: "Test Event",
    gallery_link: "https://app.pixeltrunk.com/gallery/test",
    business_name: "Test Studio",
    photographer_name: "Test",
    client_name: "{client_name}",
  });

  const shellHtml = renderEmailShell({
    body: interpolated,
    galleryUrl: "https://app.pixeltrunk.com/gallery/test",
    fromName: "Test Studio",
    password: showExtras ? "sunset2026" : null,
    downloadPin: showExtras ? "4821" : null,
    guestList: showExtras
      ? {
          url: "https://app.pixeltrunk.com/api/guest-list/EXAMPLE_TOKEN",
          message: guestListMessage,
        }
      : null,
  });

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto space-y-8">
      <h1 className="font-editorial text-3xl">Email HTML probe</h1>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={showExtras}
            onChange={(e) => setShowExtras(e.target.checked)}
            className="accent-emerald-600"
          />
          Password + PIN + guest list
        </label>
        <input
          value={guestListMessage}
          onChange={(e) => setGuestListMessage(e.target.value)}
          placeholder="Guest-list message line"
          className="text-[13px] border-b border-stone-200 outline-none py-1 flex-1 min-w-[240px]"
        />
      </div>

      <section>
        <p className="label-caps mb-2">1 · Editor</p>
        <EmailEditor value={body} onChange={setBody} />
      </section>

      <section>
        <p className="label-caps mb-2">1 · getHTML() output</p>
        <pre className="text-[12px] bg-stone-900 text-emerald-300 p-4 overflow-x-auto whitespace-pre-wrap">
          {body}
        </pre>
      </section>

      <section>
        <p className="label-caps mb-2">2 · POST body (after interpolate)</p>
        <pre className="text-[12px] bg-stone-900 text-amber-300 p-4 overflow-x-auto whitespace-pre-wrap">
          {interpolated}
        </pre>
      </section>

      <section>
        <p className="label-caps mb-2">3 · renderEmailShell — body cell only</p>
        <pre className="text-[12px] bg-stone-900 text-sky-300 p-4 overflow-x-auto whitespace-pre-wrap">
          {shellHtml.slice(
            shellHtml.indexOf("line-height:1.6"),
            shellHtml.indexOf("line-height:1.6") + 700
          )}
        </pre>
        <p className="label-caps mt-4 mb-2">3 · as a mail client sees it</p>
        <iframe
          srcDoc={shellHtml}
          className="w-full h-[520px] border border-stone-200"
          title="Rendered email"
        />
      </section>

      <section className="max-w-md">
        <p className="label-caps mb-2">Composer control (empty state)</p>
        <GuestListAttachment eventId="00000000-0000-0000-0000-000000000000" onChange={noop} />
      </section>

      <section className="max-w-lg">
        <p className="label-caps mb-2">Composer preview (must match the email)</p>
        <EmailPreview
          subject="Test"
          bodyHtml={interpolated}
          password={showExtras ? "sunset2026" : null}
          guestList={showExtras ? { message: guestListMessage } : null}
        />
      </section>
    </div>
  );
}
