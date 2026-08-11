import { describe, it, expect } from "vitest";
import { renderEmailShell } from "./shell";

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
