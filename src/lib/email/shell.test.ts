import { describe, it, expect } from "vitest";
import { renderEmailShell } from "./shell";

const GALLERY = "https://pixeltrunk.app/gallery/abc123";

describe("renderEmailShell — password card", () => {
  it("omits the card entirely when no password is passed", () => {
    const html = renderEmailShell({ body: "<p>Hi</p>", galleryUrl: GALLERY });
    expect(html).not.toContain("Gallery Password");
  });

  it("omits the card for an empty-string password", () => {
    const html = renderEmailShell({
      body: "<p>Hi</p>",
      galleryUrl: GALLERY,
      password: "",
    });
    expect(html).not.toContain("Gallery Password");
  });

  it("renders the password when given one", () => {
    const html = renderEmailShell({
      body: "<p>Hi</p>",
      galleryUrl: GALLERY,
      password: "amber-cedar-42",
    });
    expect(html).toContain("Gallery Password");
    expect(html).toContain("amber-cedar-42");
  });

  it("places the card AFTER the CTA button, not before it", () => {
    const html = renderEmailShell({
      body: "<p>Hi</p>",
      galleryUrl: GALLERY,
      password: "amber-cedar-42",
    });
    expect(html.indexOf("View Gallery")).toBeLessThan(
      html.indexOf("Gallery Password")
    );
  });

  it("keeps the card with the button when the body uses {gallery_button}", () => {
    // The token relocates the CTA; the password must follow it rather than
    // stranding itself at the bottom of the message.
    const html = renderEmailShell({
      body: "<p>Top</p>{gallery_button}<p>Bottom copy</p>",
      galleryUrl: GALLERY,
      password: "amber-cedar-42",
    });
    expect(html).toContain("Gallery Password");
    expect(html.indexOf("Gallery Password")).toBeLessThan(
      html.indexOf("Bottom copy")
    );
    expect(html).not.toContain("{gallery_button}");
  });

  it("escapes HTML in the password", () => {
    // Owner-supplied, but it lands in a rendered document — a stray < must
    // not be able to close the card's markup.
    const html = renderEmailShell({
      body: "<p>Hi</p>",
      galleryUrl: GALLERY,
      password: "<script>x</script>",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("still renders the card when there is no gallery URL (no button)", () => {
    const html = renderEmailShell({ body: "<p>Hi</p>", password: "amber-42" });
    expect(html).toContain("Gallery Password");
    expect(html).toContain("amber-42");
  });
});
