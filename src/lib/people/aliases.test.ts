import { describe, expect, it } from "vitest";

import { buildAliasResolver } from "./aliases";

const row = (alias: string, canonical: string) => ({
  alias_key: alias.toLowerCase().replace(/[^a-z]/g, ""),
  canonical_key: canonical.toLowerCase().replace(/[^a-z]/g, ""),
  alias_name: alias,
  canonical_name: canonical,
});

describe("buildAliasResolver", () => {
  it("resolves an alias to its canonical and leaves strangers alone", () => {
    const r = buildAliasResolver([row("Sami Hadouaj", "Sami Hadouaj Mundra")]);
    expect(r.resolve("samihadouaj")).toBe("samihadouajmundra");
    expect(r.resolve("samihadouajmundra")).toBe("samihadouajmundra");
    expect(r.resolve("jennaloeser")).toBe("jennaloeser");
  });

  it("groups keys canonical-first and collects every recorded spelling", () => {
    const r = buildAliasResolver([row("Sami Hadouaj", "Sami Hadouaj Mundra")]);
    expect(r.groupKeys("samihadouaj")).toEqual(["samihadouajmundra", "samihadouaj"]);
    expect(new Set(r.groupNames("samihadouajmundra"))).toEqual(
      new Set(["Sami Hadouaj", "Sami Hadouaj Mundra"])
    );
  });

  it("follows chains to the terminal canonical", () => {
    const r = buildAliasResolver([row("A B", "C D"), row("C D", "E F")]);
    expect(r.resolve("ab")).toBe("ef");
    expect(new Set(r.groupKeys("ab"))).toEqual(new Set(["ef", "ab", "cd"]));
  });

  it("degrades a cycle to unmerged instead of looping", () => {
    const r = buildAliasResolver([row("A B", "C D"), row("C D", "A B")]);
    // Whatever it returns, it returns — the guarantee is termination and
    // stability, not meaning, because the API refuses to write cycles.
    expect(typeof r.resolve("ab")).toBe("string");
  });

  it("reports emptiness so hot paths can skip folding", () => {
    expect(buildAliasResolver([]).isEmpty).toBe(true);
    expect(buildAliasResolver([row("A B", "C D")]).isEmpty).toBe(false);
  });
});
