/**
 * Branded HTML email shell.
 *
 * Wraps a body (the photographer's message, which may be plain text or simple
 * HTML) in a clean, email-client-safe layout: centered card, sensible
 * typography, a prominent "View Gallery" button, and a small footer. Uses
 * table-based layout + inline styles because that's what email clients
 * (Gmail/Outlook/Apple Mail) reliably render.
 *
 * Where the gallery button lands, first match wins:
 *   1. an explicit `{gallery_button}` token in the body;
 *   2. a paragraph that is nothing but a link to the gallery, which BECOMES
 *      the button, so it sits where the photographer put the link;
 *   3. otherwise it is appended after the body.
 * Every gallery email gets a real CTA, exactly once.
 *
 * After the gallery block come the optional cards, in a fixed order: the
 * delivery recap (`recapCard`, numbers and a bar chart drawn as table cells
 * because Gmail strips SVG), then the guest list, which closes the email.
 *
 * `renderEmailContent` is the body cell on its own. The composer preview
 * injects it directly, so the buttons and cards a photographer sees while
 * writing are this module's output and not a second copy of it.
 */

import { formatFileSize } from "../utils";
import type { SpsRecap } from "../recap/types";
import {
  formatCount,
  formatSeconds,
  recapOpenRate,
} from "../recap/normalize";
import { shootingDays } from "../recap/chart";

const ACCENT = "#10b981"; // emerald accent
const INK = "#1c1917"; // stone-900
const MUTED = "#78716c"; // stone-500
const HAIRLINE = "#e7e5e4"; // stone-200
const WASH = "#fafaf9"; // stone-50
const NEUTRAL = "#e7e5e4"; // stone-200: the guest-list card
const NEUTRAL_EDGE = "#d6d3d1"; // stone-300
const DIM = "#57534e"; // stone-600: muted text that stays readable on NEUTRAL
const SANS = "Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** Every CTA is this wide, so two buttons in one email line up. */
const BUTTON_WIDTH = 240;
const BUTTON_PADDING = "14px 16px";

/**
 * A CTA that keeps its shape everywhere.
 *
 * ONE size for every button: same width, same padding, same type. The gallery
 * button and the guest-list button used to differ in padding and font size,
 * and side by side in one email they read as two different heights (Mason,
 * 2026-10-04). Only the fill differs: emerald for the gallery, ink for a
 * second action.
 *
 * The width is `100%` capped at `max-width:240px`, NOT `240px` capped at
 * `100%`. Measured in a browser: a fixed 240px table inside these nested
 * layout tables does not shrink (a percentage max-width is ignored when the
 * parent cell sizes to its content), and it pushed the email 20px wider than
 * a 360px phone. Written this way round the button is 240px wherever there is
 * room and narrows with its card where there is not; a label too long for one
 * line wraps inside it. Outlook ignores max-width and would stretch the
 * button across the card, so an Outlook-only wrapper table pins it to 240.
 *
 * The padding is stated twice on purpose. Outlook on Windows lays mail out
 * with Word's engine, which ignores padding on an `<a>`, so a button padded
 * only there collapses to the height of its words. `mso-padding-alt` on the
 * cell is read by Outlook alone and puts the room back. Everywhere else the
 * link is `display:block` with its own padding, which makes the whole button
 * the tap target rather than just the label. NOT verified in Outlook itself
 * (no client to hand, 2026-10-04); a browser render and Gmail are what was
 * checked.
 *
 * `border-collapse:separate` is stated because the composer preview injects
 * this markup under Tailwind's reset, which collapses table borders and with
 * them the rounded corners.
 */
function ctaButton(
  url: string,
  labelHtml: string,
  fill: "accent" | "ink",
  margin: string
): string {
  const color = fill === "accent" ? ACCENT : INK;
  return `
  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="${BUTTON_WIDTH}"><tr><td><![endif]-->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:${margin};width:100%;max-width:${BUTTON_WIDTH}px;border-collapse:separate;">
    <tr>
      <td align="center" bgcolor="${color}" style="border-radius:6px;mso-padding-alt:${BUTTON_PADDING};">
        <a href="${url}"
           style="display:block;padding:${BUTTON_PADDING};font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;letter-spacing:0.02em;color:#ffffff;text-align:center;text-decoration:none;border-radius:6px;">
          ${labelHtml}
        </a>
      </td>
    </tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->`;
}

/**
 * The card a CTA sits in. A table, because it has to survive Outlook. "wash"
 * is the near-white card around the gallery button; "neutral" is a clear step
 * greyer, so the guest list reads as its own box.
 */
function card(
  inner: string,
  margin: string,
  tone: "wash" | "neutral" = "wash",
  align: "center" | "left" = "center"
): string {
  const fill = tone === "wash" ? WASH : NEUTRAL;
  const edge = tone === "wash" ? HAIRLINE : NEUTRAL_EDGE;
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${margin};border-collapse:separate;">
    <tr>
      <td align="${align}" style="padding:20px;background:${fill};border:1px solid ${edge};border-radius:8px;text-align:${align};">${inner}
      </td>
    </tr>
  </table>`;
}

function capsLabel(text: string, color: string = MUTED): string {
  return `
        <div style="font-family:${SANS};font-size:10px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${color};">
          ${escapeHtml(text)}
        </div>`;
}

/**
 * A credential, on one line under the button it unlocks. Letter-spaced
 * monospace so "rn" never reads as "m" when someone retypes it on a phone.
 */
function credentialRow(label: string, value: string, gapAbove: boolean): string {
  return `
        <div style="${gapAbove ? "padding-top:14px;" : ""}font-family:${SANS};font-size:12px;color:${MUTED};">
          ${escapeHtml(label)}&nbsp;&nbsp;<span style="font-family:${MONO};font-size:16px;font-weight:600;letter-spacing:0.14em;color:${INK};word-break:break-all;">${escapeHtml(value)}</span>
        </div>`;
}

/**
 * The gallery CTA and whatever it takes to get through it, as ONE unit.
 *
 * The password and PIN used to be cards of their own stacked under the button,
 * which made three boxes out of one job. They are what you reach for after
 * tapping through, so they ride inside the same card (Mason, 2026-10-04). With
 * no credential there is nothing to group, and the button stands bare.
 *
 * `placement` only sets the margins: "inline" sits between two paragraphs of
 * the letter, "end" closes the body.
 */
function galleryBlock(opts: {
  url?: string | null;
  /** Already HTML: either an escaped label or a link's own words. */
  labelHtml: string;
  password?: string | null;
  downloadPin?: string | null;
  placement: "inline" | "end";
}): string {
  const inline = opts.placement === "inline";
  const credentials: Array<[string, string]> = [];
  if (opts.password) credentials.push(["Gallery Password", opts.password]);
  if (opts.downloadPin) credentials.push(["Download PIN", opts.downloadPin]);

  if (credentials.length === 0) {
    return opts.url
      ? ctaButton(opts.url, opts.labelHtml, "accent", inline ? "6px auto 22px" : "20px auto 4px")
      : "";
  }
  const button = opts.url ? ctaButton(opts.url, opts.labelHtml, "accent", "0 auto") : "";
  const rows = credentials
    .map(([label, value], i) => credentialRow(label, value, !!button || i > 0))
    .join("");
  return card(button + rows, inline ? "4px 0 22px" : "20px 0 4px");
}

/**
 * Paragraph spacing, stated outright.
 *
 * Two separate failures, both measured in a browser on 2026-08-11 rather than
 * reasoned about (probe: /dev/email-html):
 *
 *  1. **A blank line was worth exactly 0px.** TipTap emits a typed blank line
 *     as `<p></p>`, and it reaches the recipient untouched — there is no
 *     sanitiser anywhere in this path, so the standing "something strips the
 *     empty paragraph" theory was wrong. An empty `<p>` simply has no content,
 *     so it measures 0px tall and its top and bottom margins collapse through
 *     it and into its siblings. Three paragraphs with a blank line between two
 *     of them rendered with the identical 15px gap as three with none. The
 *     photographer's paragraph break was deleted by CSS, not by code.
 *  2. **Nothing here styled `<p>` at all**, so every gap was whatever the
 *     reader's mail client happened to default to. Outlook.com zeroes them.
 *
 * So an empty paragraph becomes a box with real height that cannot collapse,
 * and every other paragraph carries its margin inline where no client can
 * override it. Inline styles, not a `<style>` block: Gmail strips the latter.
 */
const PARA_MARGIN = "margin:0 0 16px;";

/** A typed blank line. `&nbsp;` gives it content, so it cannot collapse away. */
const BLANK_LINE = `<div style="line-height:16px;font-size:16px;">&nbsp;</div>`;

export function normalizeBodyForEmail(html: string): string {
  return (
    html
      // Any paragraph holding nothing but whitespace, a `<br>` or an `&nbsp;`
      // is a blank line the photographer typed on purpose.
      .replace(/<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, BLANK_LINE)
      // Everything left is real copy. Merge into an existing style attribute
      // rather than appending a second one — TextAlign writes `style` too, and
      // a duplicate attribute is dropped wholesale by some clients.
      .replace(/<p\b([^>]*)>/gi, (_match, attrs: string) => {
        const withMargin = /\bstyle\s*=\s*["']/i.test(attrs)
          ? attrs.replace(/\bstyle\s*=\s*(["'])/i, `style=$1${PARA_MARGIN}`)
          : `${attrs} style="${PARA_MARGIN}"`;
        return `<p${withMargin}>`;
      })
  );
}

/**
 * Links the photographer typed read the same in every client. Unstyled, they
 * are whatever blue the reader's mail app defaults to, while the composer
 * preview has always drawn them emerald.
 */
function styleBodyLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) =>
    /\bstyle\s*=/i.test(attrs)
      ? match
      : `<a${attrs} style="color:${ACCENT};text-decoration:underline;">`
  );
}

/** The path a URL points at, so two origins for one gallery still compare equal. */
function urlPath(url: string): string | null {
  try {
    const path = new URL(url.replace(/&amp;/g, "&")).pathname.replace(/\/+$/, "");
    return path.length > 1 ? path : null;
  } catch {
    return null;
  }
}

/**
 * A paragraph holding only a link (or only a bare URL). Groups: 2 = href,
 * 3 = the link's own text, 4 = a bare URL typed with no link around it.
 *
 * Every group is BOUNDED to its own tag or paragraph: the href cannot contain
 * a quote or an angle bracket, and the link text stops at the first `</a>`,
 * `</p>` or `<p`. The first version used `.*?` and "anything but </a>", and
 * since TipTap's HTML has no newlines both ran across the whole body. That
 * matched from one paragraph's opening link to a LATER paragraph's `</a></p>`
 * and replaced everything between with one button, hid the real link line
 * behind an earlier match, and backtracked cubically (8.6 s on a 6 KB body).
 * All three have a test.
 */
const LINK_ONLY_PARAGRAPH =
  /<p\b[^>]*>\s*(?:<a\b[^>]*\bhref=(["'])([^"'<>]*)\1[^>]*>((?:(?!<\/a>|<\/?p\b)[\s\S])*)<\/a>|(https?:\/\/[^\s<]+))\s*<\/p>/gi;

/** Past this many characters a link's text is a sentence, not a button label. */
const MAX_LABEL_CHARS = 60;

/**
 * The words of a link, as HTML that is safe to put on a button. Tags are
 * dropped and a stray `<` or `>` is escaped. Entities are left exactly as the
 * editor wrote them: decoding and re-escaping them turns `&rarr;` into the
 * literal text "&rarr;".
 */
function linkWordsAsLabel(inner: string): string | null {
  const words = inner
    .replace(/<[^>]*>/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&nbsp;/g, " ")
    .trim();
  if (!words || words.length > MAX_LABEL_CHARS) return null;
  return /^https?:\/\//i.test(words) ? null : words;
}

/**
 * Turn the photographer's gallery-link line into the button, in place.
 *
 * Only a paragraph that is NOTHING BUT the gallery link qualifies: a link
 * inside a sentence is prose and stays prose. The match is on the URL's path,
 * because the composer builds its link from the browser's origin and the send
 * route rebuilds the verified one from the app's configured origin. Either
 * way the button carries `galleryUrl`, the verified one, never the typed href.
 *
 * Words the photographer chose for the link ("View your gallery →") become the
 * button's label. A link whose text is just the URL, or runs to a sentence,
 * takes the default.
 *
 * Returns null when no such paragraph exists, so the caller appends instead.
 */
function replaceGalleryLinkLine(
  content: string,
  galleryUrl: string,
  build: (labelHtml: string | null) => string
): string | null {
  const target = urlPath(galleryUrl);
  if (!target) return null;
  let placed = false;
  const out = content.replace(
    LINK_ONLY_PARAGRAPH,
    (match, _quote: string, href: string | undefined, text: string | undefined, bare: string | undefined) => {
      if (placed || urlPath(href ?? bare ?? "") !== target) return match;
      placed = true;
      return build(linkWordsAsLabel(text ?? ""));
    }
  );
  return placed ? out : null;
}

/**
 * The guest-list card.
 *
 * PII, and email-recipient-only by design (see src/lib/guest-list/store.ts):
 * it exists on no gallery surface, so this card is the entire path to it. It
 * was anchor text until 2026-10-04, kept quiet so it would not compete with
 * "View Gallery", and clients were missing it. It is now a button the same
 * size as the gallery's, filled ink where the gallery's is emerald, on a card
 * a step greyer than the gallery's. Mason picked this from rendered options:
 * an ink card was too dark, a green one too green, and emerald stays the
 * gallery's color so nobody wonders which button is the photos. The file is
 * named so it reads as a download and not as another way into the gallery.
 *
 * The raw URL is still never printed. The token is long on purpose, and a
 * 200-character string sitting in the body invites someone to paste it
 * somewhere it should not go.
 */
function guestListCard(guestList: NonNullable<EmailShellOptions["guestList"]>): string {
  const message = guestList.message?.trim();
  const line = message
    ? `
        <div style="font-family:${SANS};font-size:14px;line-height:1.5;color:${INK};padding-top:8px;">${escapeHtml(message)}</div>`
    : "";
  const file = [
    guestList.filename?.trim() ? escapeHtml(guestList.filename.trim()) : "",
    guestList.sizeBytes ? formatFileSize(guestList.sizeBytes) : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  const fileLine = file
    ? `
        <div style="font-family:${SANS};font-size:12px;line-height:1.5;color:${DIM};padding-top:4px;word-break:break-all;">${file}</div>`
    : "";
  return card(
    capsLabel("Guest List", DIM) +
      line +
      fileLine +
      ctaButton(guestList.url, "Download Guest List", "ink", "14px auto 0"),
    "22px 0 4px",
    "neutral"
  );
}

/** Tallest bar in the recap chart, in px. Gmail honors a div's height inline. */
const RECAP_BAR_MAX = 72;
/** Gap between two hours in the chart; a day break is this plus a spacer cell. */
const RECAP_BAR_GAP = 2;
const RECAP_DAY_GAP = 10;
/** The "sent" series: a step greyer than the hairline, so it reads against the wash. */
const RECAP_SENT = "#d6d3d1"; // stone-300

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Tue 22" from a local date "2026-09-22". `shootingDays` hands over the owner's
 * local date already, so this is calendar arithmetic on fixed digits: no
 * clock, no zone, the same answer on every machine.
 */
function recapDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday} ${d}`;
}

/**
 * Narrower than this a tile wraps to the next line. 100px holds "photographed"
 * at 11px and "5,119" at 24px with room; four of them need 400px, which the
 * 560px email has (438px inside the box) and a 375px phone does not (229px),
 * so the row is four across on a laptop and two by two on a phone.
 */
const RECAP_TILE_MIN = 100;

/**
 * The stat row: a number and the words under it, per tile.
 *
 * NOT table cells. Measured in a browser at phone width: four `<td>`s whose
 * longest words cannot break sum to about 300px, and a table never shrinks
 * below its content, so the whole email grew 65px past a 375px viewport (the
 * control render without the card was exactly 375). Inline-block divs with a
 * percentage width and a minimum wrap instead, two by two, inside one white
 * box. Outlook has no inline-block, so a ghost table (read by Outlook alone)
 * gives it four real cells. The wrapper zeroes its font size so the
 * whitespace between the divs is not a gap.
 */
function recapTiles(tiles: Array<[string, string]>): string {
  const pct = `${(100 / tiles.length).toFixed(2)}%`;
  const cells = tiles
    .map(
      ([value, label]) => `
              <!--[if mso]><td width="${pct}" valign="top"><![endif]-->
              <div class="recap-tile" style="display:inline-block;width:${pct};min-width:${RECAP_TILE_MIN}px;vertical-align:top;">
                <div style="padding:12px 10px;">
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:28px;font-weight:700;color:${INK};letter-spacing:-0.01em;">${escapeHtml(value)}</div>
                  <div style="font-family:${SANS};font-size:11px;line-height:15px;color:${MUTED};padding-top:3px;">${escapeHtml(label)}</div>
                </div>
              </div>
              <!--[if mso]></td><![endif]-->`
    )
    .join("");
  return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:16px;border-collapse:separate;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:6px;">
          <tr>
            <td style="padding:2px;font-size:0;line-height:0;">
              <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><![endif]-->${cells}
              <!--[if mso]></tr></table><![endif]-->
            </td>
          </tr>
        </table>`;
}

/**
 * "Galleries delivered, by hour" as table cells.
 *
 * Gmail strips `<svg>` and every `<style>` block, so a chart that has to
 * survive an inbox is a row of `<td>`s, one per hour, each holding a
 * fixed-height div. The two series stack inside ONE cell: opened is a subset
 * of sent (an opened gallery was sent first), so the ink bar is the bottom of
 * the grey one, never beside it. Heights scale to the busiest hour. Days are
 * separated by a spacer cell and labeled under their group, so the three
 * shooting days read as three groups instead of one line with the night's
 * idle hours in it.
 *
 * Every bar div zeroes its font and line-height, or a client gives the empty
 * div a line's worth of height whatever `height` says. NOT verified in
 * Outlook itself (no client to hand, 2026-10-09; same caveat as `ctaButton`).
 */
function recapChart(recap: SpsRecap): string {
  // Shooting days only: a gallery re-sent a week later is a real send but
  // not a day the booth was open (same rule as the recap page's chart).
  const days = shootingDays(recap);
  const hourCount = days.reduce((n, d) => n + d.hours.length, 0);
  if (hourCount === 0) return "";
  const maxSent = Math.max(1, ...recap.hours.map((h) => h.sent));
  const px = (n: number) => Math.round((n / maxSent) * RECAP_BAR_MAX);
  const cellWidth = `${(100 / hourCount).toFixed(2)}%`;
  const spacer = `
              <td style="width:${RECAP_DAY_GAP}px;font-size:0;line-height:0;"></td>`;

  const bars = days
    .map((day) =>
      day.hours
        .map((h) => {
          const sentH = h.sent > 0 ? Math.max(1, px(h.sent)) : 0;
          const openedH = Math.min(sentH, h.opened > 0 ? Math.max(1, px(h.opened)) : 0);
          const greyH = sentH - openedH;
          const bar = (height: number, color: string) =>
            height > 0
              ? `<div style="height:${height}px;line-height:${height}px;font-size:0;mso-line-height-rule:exactly;background:${color};">&nbsp;</div>`
              : "";
          return `
              <td class="recap-hour" valign="bottom" style="width:${cellWidth};height:${RECAP_BAR_MAX}px;vertical-align:bottom;padding:0;">${bar(greyH, RECAP_SENT)}${bar(openedH, INK)}</td>`;
        })
        .join("")
    )
    .join(spacer);

  const labels = days
    .map(
      (day) => `
              <td colspan="${day.hours.length}" align="left" style="padding-top:6px;font-family:${MONO};font-size:11px;line-height:14px;color:${MUTED};white-space:nowrap;">${escapeHtml(recapDayLabel(day.date))}</td>`
    )
    .join(spacer);

  const swatch = (color: string) =>
    `<td style="width:10px;height:10px;font-size:0;line-height:0;background:${color};">&nbsp;</td>`;

  return `
        <div style="font-family:${SANS};font-size:11px;line-height:15px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};padding:22px 0 10px;">Galleries delivered, by hour</div>
        <table role="presentation" cellpadding="0" cellspacing="${RECAP_BAR_GAP}" border="0" width="100%" style="border-collapse:separate;border-spacing:${RECAP_BAR_GAP}px 0;table-layout:fixed;">
          <tr>${bars}
          </tr>
          <tr>${labels}
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:separate;">
          <tr>
            ${swatch(RECAP_SENT)}
            <td style="padding:0 14px 0 6px;font-family:${SANS};font-size:11px;line-height:14px;color:${MUTED};">Sent</td>
            ${swatch(INK)}
            <td style="padding:0 0 0 6px;font-family:${SANS};font-size:11px;line-height:14px;color:${MUTED};">Opened</td>
          </tr>
        </table>`;
}

/**
 * The delivery recap: what the client's guests got, in numbers.
 *
 * Sits after the gallery and before the guest list. The gallery is what the
 * email is for; the recap is the story behind it (how many people walked away
 * with a finished gallery, how fast, how many opened it); the guest list
 * closes the email because it is the one thing read after the photos. Every
 * number is the archive's own snapshot of SPS (`events.recap`), handed over
 * by the send route; nothing here comes from the composer. The card links to
 * the recap page for the detail, so the email carries the headline and the
 * page carries the rest.
 */
function recapCard(recap: NonNullable<EmailShellOptions["recap"]>): string {
  const { data, url } = recap;
  const guests = data.guests;
  const event = escapeHtml(data.eventName);
  const headline =
    guests > 0
      ? `${formatCount(guests)} ${guests === 1 ? "person" : "people"} left ${event} with a finished gallery in their inbox.`
      : `${formatCount(data.linksSent)} finished galleries went out during ${event}, straight to each guest&rsquo;s inbox.`;

  const tiles: Array<[string, string]> = [
    [formatCount(guests), "guests photographed"],
    [formatCount(data.photos), "finished photos"],
  ];
  const speed = formatSeconds(data.lastFrameToSend.medianSec);
  if (speed) tiles.push([speed, "last frame to inbox"]);
  const rate = recapOpenRate(data);
  if (rate !== null) tiles.push([`${rate}%`, "opened their gallery"]);

  const inner =
    capsLabel(`${data.eventName} · Delivery recap`) +
    `
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:26px;font-weight:700;color:${INK};letter-spacing:-0.01em;padding-top:8px;">${headline}</div>` +
    recapTiles(tiles) +
    recapChart(data) +
    ctaButton(url, "See the full recap", "ink", "20px auto 0");

  return card(inner, "22px 0 4px", "wash", "left");
}

export interface EmailShellOptions {
  /** The photographer's message — plain text or simple HTML. */
  body: string;
  /** Gallery URL for the CTA button (and the {gallery_button} token). */
  galleryUrl?: string | null;
  /** Sender / studio name shown in the footer. */
  fromName?: string;
  /**
   * Event cover image — rendered as a full-bleed hero at the top of the card,
   * linked to the gallery. Must be a long-lived absolute URL (the
   * /api/gallery/[slug]/cover redirect), never a raw presigned URL.
   */
  coverImageUrl?: string | null;
  /** Event name — used as the hero image's alt text. */
  eventName?: string | null;
  /** CTA button label (defaults to "View Gallery"). */
  buttonLabel?: string;
  /**
   * Gallery password, printed under the CTA inside its card. Caller decides whether
   * to include it — this only renders what it's handed. Must come from the
   * server's own read of the event, never from the composer's payload.
   */
  password?: string | null;
  /**
   * Download PIN, when the share requires one. Same rule as the password: a
   * client who is handed a gallery that demands a PIN and no PIN is a support
   * ticket, so the credential travels with the link that needs it.
   */
  downloadPin?: string | null;
  /**
   * The SPS guest-list spreadsheet, when the photographer attached one and
   * chose to include it. `url` must be the tokenized /api/guest-list/[token]
   * link, built server-side from a token the send route has already verified
   * against the event's stored hash — never a URL taken from the composer.
   * `filename` and `sizeBytes` name the file under the message; both come
   * from the event's stored guest-list record.
   */
  guestList?: {
    url: string;
    message?: string | null;
    filename?: string | null;
    sizeBytes?: number | null;
  } | null;
  /**
   * The delivery recap card. `data` is the archive's snapshot of the event's
   * SPS numbers (`events.recap`, read through `normalizeRecap`), handed over
   * by the send route from the owner's own event row, never from the
   * composer's payload. `url` is the recap page, built from the verified
   * share slug. The route decides whether the numbers clear the floor that
   * makes them worth a client's attention; this only renders what it is given.
   */
  recap?: { data: SpsRecap; url: string } | null;
}

export type EmailContentOptions = Pick<
  EmailShellOptions,
  "body" | "galleryUrl" | "buttonLabel" | "password" | "downloadPin" | "guestList" | "recap"
>;

/**
 * The body cell: the photographer's message with the gallery block placed in
 * it and the guest-list card after it. The send path and the composer preview
 * both call this, which is what keeps the preview honest.
 */
export function renderEmailContent({
  body,
  galleryUrl,
  buttonLabel,
  password,
  downloadPin,
  guestList,
  recap,
}: EmailContentOptions): string {
  // If the body looks like plain text (no tags), preserve its line breaks.
  const looksHtml = /<[a-z][\s\S]*>/i.test(body);
  let content = looksHtml
    ? styleBodyLinks(normalizeBodyForEmail(body))
    : body.replace(/\n/g, "<br/>");

  const block = (placement: "inline" | "end", linkWords?: string | null) =>
    galleryBlock({
      url: galleryUrl,
      labelHtml: linkWords || escapeHtml(buttonLabel || "View Gallery"),
      password,
      downloadPin,
      placement,
    });

  if (content.includes("{gallery_button}")) {
    // A function, not a string: in a replacement STRING `$$`, `$&` and friends
    // are patterns, and a password like "Ca$$h" was mailed as "Ca$h".
    content = content.replace(/\{gallery_button\}/g, () => block("inline"));
  } else {
    const inPlace = galleryUrl
      ? replaceGalleryLinkLine(content, galleryUrl, (words) => block("inline", words))
      : null;
    content = inPlace ?? content + block("end");
  }

  // After the gallery, before the guest list: the story behind the photos.
  if (recap) content += recapCard(recap);

  // Last: it's the one thing here the client reads after the photos, so it
  // closes the email whatever the letter above it does.
  if (guestList) content += guestListCard(guestList);
  return content;
}

export function renderEmailShell({
  body,
  galleryUrl,
  fromName,
  coverImageUrl,
  eventName,
  buttonLabel,
  password,
  downloadPin,
  guestList,
  recap,
}: EmailShellOptions): string {
  const content = renderEmailContent({
    body,
    galleryUrl,
    buttonLabel,
    password,
    downloadPin,
    guestList,
    recap,
  });

  const year = ""; // avoid Date in shared code paths; footer year is optional

  // Full-bleed hero at the top of the card. Wrapped in the gallery link so the
  // photo itself is a tap target. display:block kills the phantom baseline gap.
  const hero = coverImageUrl
    ? `
          <tr>
            <td>
              ${galleryUrl ? `<a href="${galleryUrl}" style="display:block;text-decoration:none;">` : ""}
                <img src="${coverImageUrl}" alt="${eventName ? escapeHtml(eventName) : "Gallery cover"}"
                     width="560" style="display:block;width:100%;height:auto;border:0;"/>
              ${galleryUrl ? "</a>" : ""}
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:10px;overflow:hidden;">${hero}
          <tr>
            <td style="padding:28px 36px 8px;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${INK};letter-spacing:-0.01em;">
                ${fromName ? escapeHtml(fromName) : "Your Gallery"}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${INK};">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 28px;border-top:1px solid ${HAIRLINE};font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};">
              ${fromName ? escapeHtml(fromName) + " · " : ""}Delivered with Pixeltrunk${year}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
