"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Copy, Check, Link2, Eye, Trash2 } from "lucide-react";
import { BrandButton } from "@/components/ui/brand-button";
import { ShareChecklist } from "@/components/shares/ShareChecklist";

interface Share {
  id: string;
  slug: string;
  shareType?: string;
  isPasswordProtected: boolean;
  allowDownload: boolean;
  allowFavorites: boolean;
  expiresAt: string | null;
  customMessage: string | null;
  isActive: boolean;
  viewCount?: number;
  imageIds?: string[] | null;
  createdAt: string;
}

interface ShareModalProps {
  eventId: string;
  eventName: string;
  isOpen: boolean;
  onClose: () => void;
  /** When provided, creates a 'selection' share containing only these images */
  imageIds?: string[];
}

export function ShareModal({ eventId, eventName, isOpen, onClose, imageIds }: ShareModalProps) {
  const [shares, setShares] = useState<Share[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [hasCreatedShare, setHasCreatedShare] = useState(false);
  const [quickShareUrl, setQuickShareUrl] = useState<string | null>(null);
  const [showQuickOptions, setShowQuickOptions] = useState(false);

  // Quick mode options only
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const fetchShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/shares?eventId=${eventId}`);
      if (!res.ok) throw new Error("Failed to load shares");
      const data = await res.json();
      setShares(data.shares);
    } catch (error) {
      console.error("Failed to load shares:", error);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (isOpen) {
      setHasCreatedShare(false);
      setQuickShareUrl(null);
      setShowQuickOptions(false);
      fetchShares();
    }
  }, [isOpen, fetchShares]);

  /** Quick share: one-click creation with defaults */
  const handleQuickCreate = async () => {
    setIsCreating(true);
    try {
      const body: Record<string, unknown> = {
        eventId,
        allowDownload: true,
        allowFavorites: true,
        imageIds: imageIds?.length ? imageIds : undefined,
      };
      if (password) body.password = password;
      if (expiresAt) body.expiresAt = expiresAt;

      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create share");
      const data = await res.json();
      const url = `${window.location.origin}/gallery/${data.share.slug}`;
      setQuickShareUrl(url);
      navigator.clipboard.writeText(url);
      toast.success("Link created and copied!");
    } catch {
      toast.error("Failed to create share link");
    } finally {
      setIsCreating(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  /** Create a share link using event sharing settings as defaults */
  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          useEventDefaults: true,
          imageIds: imageIds?.length ? imageIds : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to create share");
      const data = await res.json();

      setHasCreatedShare(true);
      setShares((prev) => [data.share, ...prev]);

      // Auto-copy the link
      copyLink(data.share.slug);
      toast.success("Share link created");
    } catch (error) {
      console.error("Create share error:", error);
      toast.error("Failed to create share link");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      setShares((prev) =>
        prev.map((s) => (s.id === shareId ? { ...s, isActive: false } : s))
      );
      toast.success("Link revoked");
    } catch (error) {
      console.error("Revoke error:", error);
      toast.error("Failed to revoke link");
    }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/gallery/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
    toast.success("Link copied to clipboard");
  };

  const galleryUrl = (slug: string) =>
    `${window.location.origin}/gallery/${slug}`;

  if (!isOpen) return null;

  const activeShares = shares.filter((s) => s.isActive);
  const revokedShares = shares.filter((s) => !s.isActive);

  // Quick share mode — slim card for image selections
  const isQuickMode = !!(imageIds && imageIds.length > 0);

  if (isQuickMode) {
    return createPortal(
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="relative w-full max-w-sm mx-4 bg-white border border-stone-200 shadow-2xl p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {quickShareUrl ? (
            /* Success state — show URL */
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="font-editorial text-[20px] text-stone-900 mb-1">
                Link <span className="italic font-normal">created</span>
              </h3>
              <p className="text-[12px] text-stone-400 mb-4">Copied to clipboard</p>
              <div className="flex items-center gap-2 border border-stone-200 px-3 py-2.5 bg-stone-50">
                <p className="text-[12px] text-stone-600 font-mono truncate flex-1">
                  {quickShareUrl}
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(quickShareUrl);
                    toast.success("Copied!");
                  }}
                  className="p-1 text-stone-400 hover:text-stone-700 shrink-0 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            /* Create state */
            <>
              <h3 className="font-editorial text-[20px] text-stone-900 mb-1">
                Share <span className="italic font-normal">{imageIds.length} images</span>
              </h3>
              <p className="text-[12px] text-stone-400 mb-5">
                Create a shareable link with one click
              </p>

              <BrandButton
                onClick={handleQuickCreate}
                disabled={isCreating}
                color="emerald"
                celebrate
                className="w-full"
              >
                <Link2 className="h-4 w-4" />
                {isCreating ? "Creating..." : "Create Link"}
              </BrandButton>

              {/* Collapsed options */}
              <button
                onClick={() => setShowQuickOptions((v) => !v)}
                className="mt-3 text-[12px] text-stone-400 hover:text-stone-600 transition-colors w-full text-center"
              >
                {showQuickOptions ? "Hide options" : "More options"}
              </button>

              {showQuickOptions && (
                <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">
                  <div>
                    <label className="text-[11px] text-stone-400 mb-1 block">Password</label>
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Optional"
                      className="w-full border-b border-stone-200 bg-transparent py-1.5 text-[13px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-400 mb-1 block">Expires</label>
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="w-full border-b border-stone-200 bg-transparent py-1.5 text-[13px] text-stone-900 focus:border-stone-900 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto bg-white border border-stone-200 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-editorial text-[24px] text-stone-900">
              Share <span className="italic font-normal">link</span>
            </h2>
            <p className="text-[12px] text-stone-400 mt-0.5">
              {imageIds?.length
                ? `${imageIds.length} selected images`
                : eventName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Pre-flight checklist — shown before first share is created */}
          {!hasCreatedShare && <ShareChecklist eventId={eventId} />}

          {/* Create new share — settings now live in Design → Sharing tab */}
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-2">
              Create Link
            </h3>
            <p className="text-[12px] text-stone-400 mb-4">
              Uses your sharing defaults from the Design panel.
            </p>

            <BrandButton
              onClick={handleCreate}
              disabled={isCreating}
              color="emerald"
              celebrate
              className="w-full"
            >
              <Link2 className="h-4 w-4" />
              {isCreating
                ? "Creating..."
                : imageIds?.length
                  ? "Create selection link"
                  : "Create link"}
            </BrandButton>
          </section>

          {/* Existing shares */}
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse bg-stone-50" />
              <div className="h-16 animate-pulse bg-stone-50" />
            </div>
          ) : activeShares.length > 0 ? (
            <section>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-4">
                Active Links
              </h3>
              <div className="space-y-3">
                {activeShares.map((share) => (
                  <div
                    key={share.id}
                    className="border border-stone-100 p-4 group hover:border-stone-200 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[13px] text-stone-700 font-mono truncate max-w-[240px]">
                        {galleryUrl(share.slug)}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyLink(share.slug)}
                          className="p-1.5 text-stone-400 hover:text-stone-700 transition-colors"
                          title="Copy link"
                        >
                          {copiedSlug === share.slug ? (
                            <Check className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRevoke(share.id)}
                          className="p-1.5 text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title="Revoke link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-stone-400">
                      {share.shareType === "selection" && (
                        <span className="uppercase tracking-wider text-accent">
                          Selection{share.imageIds?.length ? ` (${share.imageIds.length})` : ""}
                        </span>
                      )}
                      {share.isPasswordProtected && (
                        <span className="uppercase tracking-wider">Protected</span>
                      )}
                      {share.expiresAt && (
                        <span className="uppercase tracking-wider">
                          Expires{" "}
                          {new Date(share.expiresAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                      {share.viewCount !== undefined && (
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {share.viewCount}
                        </span>
                      )}
                      <span>
                        {new Date(share.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Revoked shares */}
          {revokedShares.length > 0 && (
            <section>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-300 mb-3">
                Revoked
              </h3>
              <div className="space-y-2">
                {revokedShares.map((share) => (
                  <div
                    key={share.id}
                    className="border border-stone-100 p-3 opacity-50"
                  >
                    <p className="text-[12px] text-stone-400 font-mono line-through">
                      /gallery/{share.slug}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
