"use client";

import { useEffect, useState } from "react";

/**
 * One shared, live copy of the venue and client registries for every picker
 * on a page.
 *
 * The bulk BTS screen renders a picker pair PER PHOTO — three hundred rows
 * would be six hundred fetches of two lists that never change mid-session.
 * Each list is fetched once, every picker subscribes, and a venue created in
 * row 12 appears in row 13's list without a refetch, because the creating
 * picker pushes the new row into the same store.
 */

export interface KnownVenue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  eventCount: number;
}

export interface KnownOrg {
  id: string;
  name: string;
  kind: string;
  domains: string[];
  eventCount?: number;
}

class Registry<T extends { id: string }> {
  private data: T[] | null = null;
  private inFlight: Promise<T[]> | null = null;
  private subs = new Set<(rows: T[]) => void>();
  constructor(private url: string, private pick: (json: unknown) => T[]) {}

  load(): Promise<T[]> {
    if (this.data) return Promise.resolve(this.data);
    if (!this.inFlight) {
      this.inFlight = fetch(this.url)
        .then((r) => r.json())
        .then((j) => { this.data = this.pick(j); this.emit(); return this.data; })
        .catch(() => { this.data = []; this.emit(); return this.data; })
        .finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }
  add(row: T) {
    if (!this.data) this.data = [];
    if (!this.data.some((x) => x.id === row.id)) this.data = [...this.data, row];
    this.emit();
  }
  get(): T[] | null { return this.data; }
  subscribe(fn: (rows: T[]) => void) {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }
  private emit() { for (const fn of this.subs) fn(this.data ?? []); }
}

export const venues = new Registry<KnownVenue>("/api/venues", (j) => ((j as { venues?: KnownVenue[] }).venues ?? []));
export const orgs = new Registry<KnownOrg>("/api/organizations", (j) => ((j as { orgs?: KnownOrg[] }).orgs ?? []));

/** `null` until the first load resolves — callers render "Loading…" rather than an empty list. */
export function useRegistry<T extends { id: string }>(reg: Registry<T>): T[] | null {
  const [rows, setRows] = useState<T[] | null>(reg.get());
  useEffect(() => {
    const off = reg.subscribe(setRows);
    void reg.load().then(setRows);
    return off;
  }, [reg]);
  return rows;
}
