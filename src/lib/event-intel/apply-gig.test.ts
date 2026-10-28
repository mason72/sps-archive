import { describe, expect, it } from "vitest";
import { payerDomains } from "./apply-gig";

describe("payerDomains", () => {
  it("drops our own and consumer mail domains", () => {
    expect(
      payerDomains([
        "info@twodudesphoto.com",
        "a@gmail.com",
        "b@yahoo.co.uk",
        "c@me.com",
        "d@att.net",
        "e@outlook.com",
      ])
    ).toEqual([]);
  });

  it("keeps a client whose domain merely CONTAINS one of those (the old substring bug)", () => {
    expect(payerDomains(["x@acme.com", "y@chime.com", "z@matt.net", "w@outlookgroup.com"])).toEqual([
      "acme.com",
      "chime.com",
      "matt.net",
      "outlookgroup.com",
    ]);
  });

  it("is distinct and lower-cased", () => {
    expect(payerDomains(["A@Docusign.com", "b@docusign.com"])).toEqual(["docusign.com"]);
  });
});
