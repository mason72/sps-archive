import { describe, it, expect } from "vitest";
import { renderEmailShell, renderEmailContent, normalizeBodyForEmail } from "./shell";

/**
 * Captured from the real editor on 2026-08-11 (/dev/email-html): typing two
 * paragraphs with a blank line between them serialises to exactly this.
 */
const TYPED_BLANK_LINE = "<p>First.</p><p></p><p>Second.</p>";

describe("normalizeBodyForEmail", () => {
  it("turns a typed blank line into a box with real height", () => {
    const out = normalizeBodyForEmail(TYPED_BLANK_LINE);
    // The empty <p> is gone; nothing is left that can collapse to 0px.
    expect(out).not.toMatch(/<p[^>]*>\s*<\/p>/);
    expect(out).toContain("&nbsp;");
    expect(out).toContain("line-height:16px");
  });

  it("treats <p><br></p> and <p>&nbsp;</p> as blank lines too", () => {
    for (const empty of ["<p><br></p>", "<p><br/></p>", "<p>&nbsp;</p>", "<p>  </p>"]) {
      expect(normalizeBodyForEmail(`<p>a</p>${empty}<p>b</p>`)).not.toMatch(
        /<p[^>]*>\s*(&nbsp;|<br\s*\/?>)?\s*<\/p>/
      );
    }
  });

  it("states every paragraph's spacing inline — clients zero their defaults", () => {
    const out = normalizeBodyForEmail("<p>a</p><p>b</p>");
    expect(out.match(/margin:0 0 16px/g)).toHaveLength(2);
  });

  it("merges into an existing style rather than adding a second attribute", () => {
    const out = normalizeBodyForEmail('<p style="text-align: center">a</p>');
    expect(out).toBe('<p style="margin:0 0 16px;text-align: center">a</p>');
    expect(out.match(/style=/g)).toHaveLength(1);
  });

  it("keeps the paragraph's own content and other attributes", () => {
    const out = normalizeBodyForEmail('<p class="x">hello <strong>you</strong></p>');
    expect(out).toContain('class="x"');
    expect(out).toContain("hello <strong>you</strong>");
  });

  it("leaves non-paragraph content alone", () => {
    const out = normalizeBodyForEmail("<h1>Title</h1><ul><li>one</li></ul>");
    expect(out).toBe("<h1>Title</h1><ul><li>one</li></ul>");
  });

  it("survives the shell: a blank line reaches the recipient as a spacer", () => {
    const html = renderEmailShell({ body: TYPED_BLANK_LINE });
    expect(html).toContain("&nbsp;");
    expect(html).not.toContain("<p></p>");
  });

  it("does not mangle a plain-text body (no tags → <br/> path)", () => {
    const html = renderEmailShell({ body: "line one\nline two" });
    expect(html).toContain("line one<br/>line two");
  });
});

describe("renderEmailShell guest list", () => {
  const URL_ = "https://app.pixeltrunk.com/api/guest-list/tok_abc";

  it("renders a button, never the raw URL as visible copy", () => {
    const html = renderEmailShell({ body: "hi", guestList: { url: URL_ } });
    expect(html).toContain("Download Guest List");
    expect(html).toContain(`href="${URL_}"`);
    // The token appears only inside href — never printed for the eye.
    expect(html).not.toMatch(/>\s*https:\/\/app\.pixeltrunk\.com\/api\/guest-list/);
  });

  it("prints the optional message line above the button", () => {
    const html = renderEmailShell({
      body: "hi",
      guestList: { url: URL_, message: "Everyone who signed in." },
    });
    expect(html).toContain("Everyone who signed in.");
  });

  it("omits the card entirely when no sheet is attached", () => {
    expect(renderEmailShell({ body: "hi" })).not.toContain("Download Guest List");
    expect(renderEmailShell({ body: "hi", guestList: null })).not.toContain(
      "Guest List"
    );
  });

  it("escapes the message — it is composer input", () => {
    const html = renderEmailShell({
      body: "hi",
      guestList: { url: URL_, message: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sits after the credentials, so the CTA and password come first", () => {
    const html = renderEmailShell({
      body: "hi",
      password: "sunset2026",
      downloadPin: "4821",
      guestList: { url: URL_ },
    });
    expect(html.indexOf("Download Guest List")).toBeGreaterThan(
      html.indexOf("Download PIN")
    );
  });

  it("names the file under the message, so it reads as a download", () => {
    const html = renderEmailShell({
      body: "hi",
      guestList: { url: URL_, filename: "aaoms-guest-list.xlsx", sizeBytes: 246_374 },
    });
    expect(html).toContain("aaoms-guest-list.xlsx &middot; 240.6 KB");
  });

  it("omits the file line when the record has no name or size", () => {
    const html = renderEmailShell({ body: "hi", guestList: { url: URL_ } });
    expect(html).not.toContain("&middot;");
  });

  it("escapes the filename: it is whatever the photographer uploaded", () => {
    const html = renderEmailShell({
      body: "hi",
      guestList: { url: URL_, filename: "<img src=x onerror=alert(1)>.xlsx" },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("is an ink button on its own grey card: never the gallery's emerald", () => {
    const html = renderEmailContent({ body: "hi", guestList: { url: URL_ } });
    const cell = html.slice(html.lastIndexOf("<td", html.indexOf(`href="${URL_}"`)));
    expect(cell).toMatch(/^<td[^>]*bgcolor="#1c1917"/);
    const cardStart = html.lastIndexOf('width="100%"', html.indexOf("Guest List"));
    expect(html.slice(cardStart, html.indexOf("Guest List"))).toContain("background:#e7e5e4");
  });

  it("is the same size as the gallery button: one width, one padding, one type size", () => {
    const html = renderEmailContent({
      body: "hi",
      galleryUrl: GALLERY,
      downloadPin: "1077",
      guestList: { url: URL_ },
    });
    // Everything about a button except its fill and its margin.
    const shape = (href: string) => {
      const at = html.indexOf(`href="${href}"`);
      const table = html.slice(html.lastIndexOf("<table", at), html.indexOf("</a>", at));
      return table
        .replace(/margin:[^;]*;/, "")
        .replace(/bgcolor="[^"]*"/, "")
        .replace(/href="[^"]*"/, "")
        .replace(/>\s*[^<>]*$/, ">");
    };
    // This way round, never `width:240px;max-width:100%`: that one does not
    // shrink inside nested layout tables and overflowed a 360px phone.
    expect(shape(GALLERY)).toContain("width:100%;max-width:240px");
    expect(shape(URL_)).toBe(shape(GALLERY));
  });

  it("closes the email even when the gallery block sits inside the letter", () => {
    const html = renderEmailContent({
      body: `<p>Hi,</p><p><a href="${GALLERY}">${GALLERY}</a></p><p>Best, Mason</p>`,
      galleryUrl: GALLERY,
      downloadPin: "1077",
      guestList: { url: URL_ },
    });
    expect(html.indexOf("View Gallery")).toBeLessThan(html.indexOf("Best, Mason"));
    expect(html.indexOf("Download Guest List")).toBeGreaterThan(html.indexOf("Best, Mason"));
  });
});

const GALLERY = "https://app.pixeltrunk.com/gallery/0_wiEiSq94";
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("renderEmailContent gallery button placement", () => {
  /** What TipTap emits for the starter template's link line. */
  const LINK_LINE = `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${GALLERY}">${GALLERY}</a></p>`;

  it("turns a link-only line into the button, where the photographer put it", () => {
    const html = renderEmailContent({
      body: `<p>Click below:</p>${LINK_LINE}<p>Best, Mason</p>`,
      galleryUrl: GALLERY,
    });
    // Exactly one way in: the typed link is gone, and nothing was appended.
    expect(count(html, `href="${GALLERY}"`)).toBe(1);
    expect(html).not.toContain(`>${GALLERY}<`);
    expect(html.indexOf("Click below:")).toBeLessThan(html.indexOf("View Gallery"));
    expect(html.indexOf("View Gallery")).toBeLessThan(html.indexOf("Best, Mason"));
  });

  it("matches on the path, and the button carries the VERIFIED url", () => {
    const typed = "http://localhost:3000/gallery/0_wiEiSq94";
    const html = renderEmailContent({
      body: `<p><a href="${typed}">${typed}</a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain(`href="${GALLERY}"`);
    expect(html).not.toContain("localhost");
  });

  it("handles a bare URL typed with no link around it", () => {
    const html = renderEmailContent({
      body: `<p>Hi</p><p>${GALLERY}</p>`,
      galleryUrl: GALLERY,
    });
    expect(count(html, GALLERY)).toBe(1);
    expect(html).toContain("View Gallery");
  });

  it("keeps the photographer's own words as the button label", () => {
    const html = renderEmailContent({
      body: `<p><a href="${GALLERY}">View your gallery &amp; pick favorites →</a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain("View your gallery &amp; pick favorites →");
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("View Gallery");
  });

  it("leaves a link inside a sentence alone, and appends the button", () => {
    const html = renderEmailContent({
      body: `<p>Your gallery is <a href="${GALLERY}">here</a>, enjoy.</p><p>Best, Mason</p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain(">here</a>, enjoy.");
    expect(count(html, `href="${GALLERY}"`)).toBe(2);
    expect(html.indexOf("View Gallery")).toBeGreaterThan(html.indexOf("Best, Mason"));
  });

  it("leaves a link-only line to somewhere else alone", () => {
    const other = "https://twodudesphoto.com/reviews";
    const html = renderEmailContent({
      body: `<p><a href="${other}">${other}</a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain(`>${other}</a>`);
    expect(count(html, `href="${GALLERY}"`)).toBe(1);
  });

  it("replaces only the first of two link lines", () => {
    const html = renderEmailContent({ body: LINK_LINE + LINK_LINE, galleryUrl: GALLERY });
    expect(count(html, "View Gallery")).toBe(1);
    expect(count(html, `href="${GALLERY}"`)).toBe(2);
  });

  it("an explicit {gallery_button} token wins over a link line", () => {
    const html = renderEmailContent({
      body: `${LINK_LINE}<p>then</p>{gallery_button}`,
      galleryUrl: GALLERY,
      buttonLabel: "Create Your Account",
    });
    expect(html).not.toContain("{gallery_button}");
    expect(html.indexOf("Create Your Account")).toBeGreaterThan(html.indexOf("then"));
    expect(html).toContain(`>${GALLERY}</a>`);
  });

  it("appends the button when the body never mentions the gallery", () => {
    const html = renderEmailContent({ body: "<p>Hi</p>", galleryUrl: GALLERY });
    expect(html.indexOf("View Gallery")).toBeGreaterThan(html.indexOf("Hi"));
  });

  it("carries the credentials inside the button's card, not after the letter", () => {
    const html = renderEmailContent({
      body: `${LINK_LINE}<p>Best, Mason</p>`,
      galleryUrl: GALLERY,
      password: "sunset2026",
      downloadPin: "1077",
    });
    const signOff = html.indexOf("Best, Mason");
    expect(html.indexOf("sunset2026")).toBeLessThan(signOff);
    expect(html.indexOf("1077")).toBeLessThan(signOff);
    expect(html.indexOf("View Gallery")).toBeLessThan(html.indexOf("sunset2026"));
  });

  // The next five came from an independent review of the first version, whose
  // pattern let the href and the link text run past their own tag. Each input
  // below produced the wrong email before the groups were bounded.
  it("never swallows the paragraphs after a gallery link that carries a query", () => {
    const html = renderEmailContent({
      body: `<p><a href="${GALLERY}?utm_source=email">Your gallery</a> is ready.</p><p>Pick favorites by Friday.</p><p><a href="https://g.page/r/review">Leave us a review</a></p><p>Best, Mason</p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain("is ready.");
    expect(html).toContain("Pick favorites by Friday.</p>");
    expect(html).toContain(">Leave us a review</a>");
    expect(html.indexOf("View Gallery")).toBeGreaterThan(html.indexOf("Best, Mason"));
  });

  it("finds the link line when an earlier paragraph opens with a link", () => {
    const html = renderEmailContent({
      body: `<p><a href="https://twodudesphoto.com">Two Dudes Photo</a> here.</p><p>Click below:</p>${LINK_LINE}<p>Best, Mason</p>`,
      galleryUrl: GALLERY,
    });
    expect(count(html, `href="${GALLERY}"`)).toBe(1);
    expect(html).toContain(">Two Dudes Photo</a> here.");
    expect(html.indexOf("View Gallery")).toBeLessThan(html.indexOf("Best, Mason"));
  });

  it("stays fast on a body built to make the pattern backtrack", () => {
    const started = performance.now();
    for (const hostile of ['<p><a href="x">', "<p ", '<p><a href="x">y</a> z']) {
      renderEmailContent({ body: hostile.repeat(3000), galleryUrl: GALLERY });
    }
    // The first version took 8.6 s on 6 KB of the first shape alone.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("prints a password containing $ intact on the {gallery_button} path", () => {
    const html = renderEmailContent({
      body: "<p>Hello</p>{gallery_button}<p>Bye</p>",
      galleryUrl: GALLERY,
      password: "Ca$$h$&2026",
    });
    expect(html).toContain("Ca$$h$&amp;2026");
    expect(html).not.toContain("{gallery_button}");
  });

  it("keeps entities in the link's words as written, never double-escaped", () => {
    const html = renderEmailContent({
      body: `<p><a href="${GALLERY}">View gallery &rarr; <strong>now</strong></a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain("View gallery &rarr; now");
    expect(html).not.toContain("&amp;rarr;");
  });

  it("escapes a stray tag opener in the link's words", () => {
    const html = renderEmailContent({
      body: `<p><a href="${GALLERY}">Open <img src=x onerror=alert(1)</a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).not.toContain("<img src=x");
  });

  it("falls back to the default label when the link's words are a paragraph", () => {
    const html = renderEmailContent({
      body: `<p><a href="${GALLERY}">${"A very long sentence that is not a button label. ".repeat(3)}</a></p>`,
      galleryUrl: GALLERY,
    });
    expect(html).toContain("View Gallery");
    expect(html).not.toContain("A very long sentence");
  });

  it("keeps Outlook's padding on the cell, where Outlook reads it", () => {
    const html = renderEmailContent({ body: "<p>Hi</p>", galleryUrl: GALLERY });
    expect(html).toContain("mso-padding-alt:14px 16px");
  });
});

describe("renderEmailContent body links", () => {
  it("colors a typed link, so it is not each mail app's default blue", () => {
    const html = renderEmailContent({
      body: '<p>See <a href="https://twodudesphoto.com">our site</a>.</p>',
    });
    expect(html).toContain(
      '<a href="https://twodudesphoto.com" style="color:#10b981;text-decoration:underline;">'
    );
  });

  it("leaves a link that already states its own style alone", () => {
    const body = '<p>See <a href="https://x.test" style="color:red">this</a>.</p>';
    expect(renderEmailContent({ body })).toContain('style="color:red"');
    expect(renderEmailContent({ body })).not.toContain("#10b981");
  });
});

describe("renderEmailShell credentials", () => {
  it("prints the gallery password when given one", () => {
    const html = renderEmailShell({ body: "hi", password: "sunset2026" });
    expect(html).toContain("Gallery Password");
    expect(html).toContain("sunset2026");
  });

  it("prints the download PIN when the share requires one", () => {
    const html = renderEmailShell({ body: "hi", downloadPin: "4821" });
    expect(html).toContain("Download PIN");
    expect(html).toContain("4821");
  });

  it("prints both, PIN after the password", () => {
    const html = renderEmailShell({
      body: "hi",
      password: "sunset2026",
      downloadPin: "4821",
    });
    expect(html.indexOf("Download PIN")).toBeGreaterThan(
      html.indexOf("Gallery Password")
    );
  });

  it("omits each card when its credential is absent", () => {
    expect(renderEmailShell({ body: "hi", password: "abc" })).not.toContain(
      "Download PIN"
    );
    expect(renderEmailShell({ body: "hi", downloadPin: "1234" })).not.toContain(
      "Gallery Password"
    );
    const bare = renderEmailShell({ body: "hi" });
    expect(bare).not.toContain("Gallery Password");
    expect(bare).not.toContain("Download PIN");
  });

  it("escapes credentials — a PIN/password is never raw HTML", () => {
    const html = renderEmailShell({
      body: "hi",
      password: '<script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
