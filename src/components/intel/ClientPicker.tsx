"use client";

import { useEffect, useMemo, useState } from "react";
import { Combobox, type ComboOption, type ComboValue } from "./Combobox";

interface KnownOrg { id: string; name: string; kind: string; domains: string[]; eventCount?: number }

/** Pick a client: yours, or create one by name. Domains are added later on /intel. */
export function ClientPicker({
  value,
  onChange,
  disabled,
}: {
  value: ComboValue | null;
  onChange: (v: ComboValue | null) => void;
  disabled?: boolean;
}) {
  const [known, setKnown] = useState<KnownOrg[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((j) => { if (alive) setKnown((j.organizations ?? j.orgs ?? []) as KnownOrg[]); })
      .catch(() => { if (alive) setKnown([]); });
    return () => { alive = false; };
  }, []);

  const options = useMemo<ComboOption[]>(() => {
    const q = query.trim().toLowerCase();
    const mine = (known ?? []).filter((o) => !q || `${o.name} ${o.domains.join(" ")}`.toLowerCase().includes(q));
    const out: ComboOption[] = mine.slice(0, 10).map((o) => ({
      key: `mine:${o.id}`, label: o.name, sub: o.domains[0], group: "Your clients",
    }));
    if (q.length >= 2 && !mine.some((o) => o.name.toLowerCase() === q)) {
      out.push({ key: `new:${query.trim()}`, label: `Create “${query.trim()}”`, sub: "Add their email domain later on Intel", group: "New" });
    }
    return out;
  }, [query, known]);

  const pick = async (o: ComboOption) => {
    setError(null);
    const kind = o.key.slice(0, o.key.indexOf(":"));
    const rest = o.key.slice(o.key.indexOf(":") + 1);
    if (kind === "mine") {
      const org = known?.find((x) => x.id === rest);
      if (org) onChange({ id: org.id, name: org.name, sub: org.domains[0] });
      return;
    }
    const c = await fetch("/api/organizations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rest }),
    });
    const cj = await c.json();
    if (!c.ok) { setError(cj.error ?? "Could not add client"); return; }
    const row: KnownOrg = { id: cj.id, name: rest, kind: "unknown", domains: [] };
    setKnown((k) => [...(k ?? []), row]);
    onChange({ id: row.id, name: row.name });
  };

  return (
    <Combobox
      value={value}
      placeholder={known === null ? "Loading clients…" : "Client"}
      query={query}
      onQuery={setQuery}
      options={options}
      onPick={pick}
      onClear={() => { onChange(null); setQuery(""); }}
      hint={error}
      disabled={disabled}
    />
  );
}
