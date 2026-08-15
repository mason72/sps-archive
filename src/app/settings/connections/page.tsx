"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { AppNavServer } from "@/components/layout/AppNavServer";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
import { ArrowLeft, Check, Link2, Unlink, AlertCircle } from "lucide-react";

/**
 * Settings → Connections. Today that means SimplePhotoShare.
 *
 * The paste target for the token SPS mints. SPS shows that token exactly once,
 * so this screen validates it on save and reports how many events came back —
 * a truncated paste has to fail here, at the paste, rather than at the first
 * import where it would read as "the integration is broken".
 *
 * The token is never rendered back. Once saved, the only thing this screen
 * knows about it is the masked prefix the server returns.
 */

interface ConnectionStatus {
  connected: boolean;
  tokenPrefix: string | null;
  connectedAt: string | null;
  lastPullAt: string | null;
  eventCount?: number;
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ConnectionsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) router.push("/login");
  }, [user, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sps/connection");
      if (res.ok) setStatus(await res.json());
    } catch (err) {
      console.error("Load connection failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sps/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save the token.");
        return;
      }
      setStatus(data);
      setEventCount(typeof data.eventCount === "number" ? data.eventCount : null);
      // Clear the field the moment it's stored — no reason for a credential to
      // sit in a form the browser might offer to remember.
      setToken("");
    } catch {
      setError("Could not reach Pixeltrunk to save the token.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sps/connection", { method: "DELETE" });
      if (res.ok) {
        setStatus(await res.json());
        setEventCount(null);
      }
    } catch {
      setError("Could not disconnect.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) return null;

  const connected = status?.connected === true;

  return (
    <div className="min-h-screen">
      <Nav>
        <AppNavServer />
      </Nav>

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-3xl">
        <div className="mb-10">
          <Link
            href="/account"
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={12} />
            Account Settings
          </Link>
          <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
            Connections
          </h1>
          <p className="caption-italic mt-3">
            Bring finished shoots in from the services you already use.
          </p>
        </div>

        {isLoading ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-stone-400">Loading…</p>
          </div>
        ) : (
          <section className="border border-stone-200">
            {/* Card header */}
            <div className="flex items-start justify-between gap-6 p-6 border-b border-stone-100">
              <div>
                <h2 className="text-[17px] font-medium text-stone-900 mb-1">
                  SimplePhotoShare
                </h2>
                <p className="text-[13px] text-stone-400 leading-[1.7] max-w-sm">
                  Pull the camera files from a completed event straight into the
                  archive — no re-export, no second upload.
                </p>
              </div>
              <span
                className={
                  connected
                    ? "label-caps text-accent shrink-0 inline-flex items-center gap-1.5"
                    : "label-caps text-stone-300 shrink-0"
                }
              >
                {connected && <Check size={12} />}
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>

            <div className="p-6">
              {connected ? (
                <>
                  <dl className="space-y-3 mb-8">
                    <div className="flex items-baseline gap-3">
                      <dt className="label-caps text-stone-300 w-24 shrink-0">Key</dt>
                      <dd className="text-[14px] text-stone-700 font-mono">
                        {status?.tokenPrefix}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <dt className="label-caps text-stone-300 w-24 shrink-0">
                        Connected
                      </dt>
                      <dd className="text-[14px] text-stone-700">
                        {formatWhen(status?.connectedAt ?? null) ?? "—"}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <dt className="label-caps text-stone-300 w-24 shrink-0">
                        Last pull
                      </dt>
                      <dd className="text-[14px] text-stone-700">
                        {formatWhen(status?.lastPullAt ?? null) ?? "Never"}
                      </dd>
                    </div>
                  </dl>

                  {eventCount !== null && (
                    <p className="text-[13px] text-accent mb-8 inline-flex items-center gap-1.5">
                      <Check size={13} />
                      {eventCount === 1
                        ? "1 completed event ready to import."
                        : `${eventCount} completed events ready to import.`}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <BrandButton onClick={() => router.push("/events/import")}>
                      <Link2 size={14} />
                      Import an event
                    </BrandButton>
                    <button
                      onClick={handleDisconnect}
                      disabled={isSaving}
                      className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Unlink size={13} />
                      Disconnect
                    </button>
                  </div>

                  <div className="editorial-divider my-8">
                    <span className="label-caps shrink-0">Replace key</span>
                  </div>
                  <TokenField
                    token={token}
                    setToken={setToken}
                    onSubmit={handleConnect}
                    isSaving={isSaving}
                    label="Paste a newly minted token to replace this one."
                  />
                </>
              ) : (
                <>
                  <ol className="space-y-3 mb-8 text-[14px] text-stone-600 leading-[1.7]">
                    <li className="flex gap-3">
                      <span className="label-caps text-stone-300 shrink-0 pt-1">
                        01
                      </span>
                      <span>
                        In SimplePhotoShare, open{" "}
                        <span className="text-stone-900">
                          Settings → Pixeltrunk
                        </span>{" "}
                        and choose Connect.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="label-caps text-stone-300 shrink-0 pt-1">
                        02
                      </span>
                      <span>
                        Copy the key it shows. It appears once — but re-minting is
                        free if you lose it.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="label-caps text-stone-300 shrink-0 pt-1">
                        03
                      </span>
                      <span>Paste it below. We&apos;ll check it against SPS right away.</span>
                    </li>
                  </ol>
                  <TokenField
                    token={token}
                    setToken={setToken}
                    onSubmit={handleConnect}
                    isSaving={isSaving}
                    label="Connection key"
                  />
                </>
              )}

              {error && (
                <p className="mt-4 text-[13px] text-red-600 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </p>
              )}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}

function TokenField({
  token,
  setToken,
  onSubmit,
  isSaving,
  label,
}: {
  token: string;
  setToken: (v: string) => void;
  onSubmit: () => void;
  isSaving: boolean;
  label: string;
}) {
  return (
    <div>
      <label htmlFor="sps-token" className="label-caps mb-3 block">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="sps-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="spsa_…"
          className="h-11 flex-1 min-w-[260px] border-b border-stone-200 bg-transparent text-[15px] font-mono text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
        />
        <BrandButton onClick={onSubmit} disabled={!token.trim() || isSaving}>
          {isSaving ? "Checking…" : "Connect"}
        </BrandButton>
      </div>
    </div>
  );
}
