import { describe, it, expect } from "vitest";
import { renderEmailShell, normalizeBodyForEmail } from "./shell";

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

  it("renders anchor text, never the raw URL as visible copy", () => {
    const html = renderEmailShell({ body: "hi", guestList: { url: URL_ } });
    expect(html).toContain("Download the guest list");
    expect(html).toContain(`href="${URL_}"`);
    // The token appears only inside href — never printed for the eye.
    expect(html).not.toMatch(/>\s*https:\/\/app\.pixeltrunk\.com\/api\/guest-list/);
  });

  it("prints the optional message line above the link", () => {
    const html = renderEmailShell({
      body: "hi",
      guestList: { url: URL_, message: "Everyone who signed in." },
    });
    expect(html).toContain("Everyone who signed in.");
  });

  it("omits the card entirely when no sheet is attached", () => {
    expect(renderEmailShell({ body: "hi" })).not.toContain("Download the guest list");
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
    expect(html.indexOf("Download the guest list")).toBeGreaterThan(
      html.indexOf("Download PIN")
    );
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
