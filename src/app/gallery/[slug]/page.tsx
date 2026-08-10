"use client";

import { useState, useEffect, useCallback, useRef, use, useMemo } from "react";
import { Download, ChevronLeft, ChevronRight, ChevronDown, X, Heart, Search, ScanFace } from "lucide-react";
import { FindMyPhotos } from "@/components/gallery/FindMyPhotos";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { SectionedGallery } from "@/components/gallery/SectionedGallery";
import { StackModal } from "@/components/gallery/StackModal";
import { buildStacks, type GalleryStack } from "@/lib/gallery/stacks";
import { CoverSection } from "@/components/gallery/CoverSection";
import { PasswordGate } from "@/components/gallery/PasswordGate";
import { toast } from "sonner";
import { pixelBurstAt } from "@/hooks/usePixelBurst";
import type { GalleryData, GalleryImage, GalleryBranding } from "@/types/gallery";

/* ─── Font class mappings ─── */
const HEADING_FONT_CLASS: Record<string, string> = {
  playfair: "font-editorial",     // Playfair Display — already loaded globally
  inter: "font-sans",             // Inter — already loaded globally
  cormorant: "font-cormorant",
  "dm-serif": "font-dm-serif",
  "space-grotesk": "font-space-grotesk",
};

const BODY_FONT_CLASS: Record<string, string> = {
  inter: "font-sans",
  "source-serif": "font-source-serif",
  lora: "font-lora",
  "dm-sans": "font-dm-sans",
};

/** PIN prompt modal for download protection */
function PinPromptModal({ onSubmit, onClose }: { onSubmit: (pin: string) => void; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-8 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-editorial text-[20px] text-stone-900 mb-2">Download PIN</h3>
        <p className="text-[13px] text-stone-400 mb-6">Enter the 4-digit PIN to download</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={e => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
            setError("");
          }}
          autoFocus
          className="w-full text-center text-[24px] tracking-[0.5em] font-mono border-b border-stone-200 bg-transparent py-3 focus:border-stone-900 focus:outline-none transition-colors"
          placeholder="&#x2022; &#x2022; &#x2022; &#x2022;"
          onKeyDown={e => {
            if (e.key === "Enter" && pin.length === 4) onSubmit(pin);
          }}
        />
        {error && <p className="text-[12px] text-red-500 mt-2 text-center">{error}</p>}
        <button
          onClick={() => pin.length === 4 && onSubmit(pin)}
          disabled={pin.length !== 4}
          className="mt-6 w-full py-2.5 text-[13px] text-white bg-stone-900 hover:bg-stone-800 transition-colors disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>
  );
}


export default function GalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authMeta, setAuthMeta] = useState<{
    eventName: string;
    customMessage: string | null;
    branding: GalleryBranding | null;
    hasCover: boolean;
    palette: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [preparingDownload, setPreparingDownload] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // PIN prompt state
  const [showPinModal, setShowPinModal] = useState(false);
  // G5: Favorite milestone thresholds
  const favoriteThresholdsRef = useRef(new Set<number>());
  // Bulk actions carry their download query through the PIN flow so "Download
  // favorites"/section/stack survive verification intact. verify-pin returns a
  // short-lived download token; bulk URLs send the TOKEN (?dt=) so the raw
  // PIN never appears in a URL, and the server re-checks it on EVERY request.
  const [pinAction, setPinAction] = useState<
    | { type: "bulk"; query: Record<string, string> }
    | { type: "individual"; image: GalleryImage }
    | null
  >(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  // Active background-ZIP poller (job id) — prevents duplicate poll loops.
  const zipPollRef = useRef<string | null>(null);

  // Guest-side Smart Stacks preference — local to this visitor, persisted per
  // share. Only meaningful when the event has stacks enabled.
  // Open stack mini-gallery (click a stack card → its members in a modal).
  const [openStack, setOpenStack] = useState<GalleryStack | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  // Selfie search (opt-in per event): matched image ids, or null when idle.
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [selfieMatches, setSelfieMatches] = useState<string[] | null>(null);
  // Active section (reported up from SectionedGallery) for the header label.
  const [activeSectionInfo, setActiveSectionInfo] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  // ─── Single-person view ───
  // A share of one person's photos resolves to exactly ONE stack, and a stack
  // of one tile is a worse gallery than no stack at all: the guest lands on a
  // single mystery thumbnail with 19 photos hidden behind a click. When the set
  // is one person, lead with their NAME and lay every frame out flat.
  const singlePerson = useMemo(() => {
    const imgs = gallery?.images ?? [];
    if (imgs.length < 2) return null;
    const groups = buildStacks(imgs);
    if (groups.length !== 1) return null;
    const only = groups[0];
    if (only.images.length !== imgs.length) return null;
    return only.personName?.trim() || null;
  }, [gallery]);

  // ─── Guest search: names first, then visual ───
  // Name/filename matching stays instant and local. When it comes up empty
  // (guests describe photos, they don't know filenames), fall through to the
  // share-scoped semantic endpoint — which returns ONLY ids, resolved against
  // the payload's already-visible images, so nothing outside the share can
  // ever render.
  const nameMatches = useMemo(() => {
    if (!gallery || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return gallery.images.filter(
      (img) =>
        (img.parsedName && img.parsedName.toLowerCase().includes(q)) ||
        img.originalFilename.toLowerCase().includes(q)
    );
  }, [gallery, searchQuery]);

  const [semanticResult, setSemanticResult] = useState<{
    query: string;
    ids: string[];
  } | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim();
    if (
      !gallery ||
      q.length < 3 ||
      nameMatches.length > 0 ||
      gallery.settings?.guestSearch === false
    ) {
      setSemanticLoading(false);
      return;
    }
    if (semanticResult?.query === q) return; // already have this answer
    setSemanticLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/gallery/${slug}/search?q=${encodeURIComponent(q)}`
        );
        if (!res.ok) throw new Error(`search ${res.status}`);
        const data = (await res.json()) as { results?: { id: string }[] };
        setSemanticResult({ query: q, ids: (data.results ?? []).map((r) => r.id) });
      } catch {
        setSemanticResult({ query: q, ids: [] });
      } finally {
        setSemanticLoading(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [gallery, slug, searchQuery, nameMatches.length, semanticResult]);

  const semanticActive =
    nameMatches.length === 0 && semanticResult?.query === searchQuery.trim();

  const filteredImages = useMemo(() => {
    if (!gallery || !searchQuery.trim()) return gallery?.images ?? [];
    if (nameMatches.length > 0) return nameMatches;
    if (semanticActive && semanticResult) {
      // Preserve similarity ranking from the search endpoint.
      const rank = new Map(semanticResult.ids.map((id, i) => [id, i]));
      return gallery.images
        .filter((img) => rank.has(img.id))
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }
    return [];
  }, [gallery, searchQuery, nameMatches, semanticActive, semanticResult]);

  // What SectionedGallery is actually showing (active tab + favorites filter +
  // sort). Null until it reports (or when the gallery has no sections).
  const [sectionVisibleImages, setSectionVisibleImages] = useState<
    GalleryImage[] | null
  >(null);

  // "Your photos" view after a selfie match — ids resolved against the
  // payload's visible set, same containment as guest search.
  const selfieImages = useMemo(() => {
    if (!gallery || !selfieMatches) return [];
    const keep = new Set(selfieMatches);
    return gallery.images.filter((img) => keep.has(img.id));
  }, [gallery, selfieMatches]);

  // The list the lightbox navigates: exactly what's on screen, in on-screen
  // order. With smart stacks on, flatten in stack order so a person's photos
  // are adjacent (open a stack → arrows walk that person first).
  const lightboxImages = useMemo(() => {
    let list: GalleryImage[];
    if (searchQuery.trim()) {
      list = filteredImages;
    } else if (selfieMatches) {
      list = selfieImages;
    } else if (gallery?.sections?.length && sectionVisibleImages) {
      list = sectionVisibleImages;
    } else {
      list = gallery?.images ?? [];
    }
    if (gallery?.settings?.smartStacks) {
      list = buildStacks(list).flatMap((stack) => stack.images);
    }
    return list;
  }, [gallery, searchQuery, filteredImages, selfieMatches, selfieImages, sectionVisibleImages]);

  const fetchGallery = useCallback(async () => {
    try {
      const res = await fetch(`/api/gallery/${slug}`);

      if (res.status === 404) {
        setError("This gallery doesn't exist or has been removed.");
        return;
      }
      if (res.status === 410) {
        setError("This gallery link has expired.");
        return;
      }

      const data = await res.json();

      if (data.requiresAuth) {
        setRequiresAuth(true);
        setAuthMeta({
          eventName: data.eventName,
          customMessage: data.customMessage,
          branding: data.branding || null,
          hasCover: !!data.hasCover,
          palette: Array.isArray(data.palette) ? data.palette : [],
        });
        return;
      }

      setGallery(data);
      setRequiresAuth(false);

      // Load favorites from localStorage
      loadFavorites(data.shareId);

    } catch {
      setError("Failed to load gallery.");
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  // Auto-focus lightbox when it opens for keyboard navigation
  useEffect(() => {
    if (selectedImageId && lightboxRef.current) {
      lightboxRef.current.focus();
    }
  }, [selectedImageId]);

  // First-ever lightbox open: hint that ← → navigate (once per browser).
  const [showKeyHint, setShowKeyHint] = useState(false);
  const keyHintShownRef = useRef(false);
  useEffect(() => {
    if (!selectedImageId || keyHintShownRef.current) return;
    try {
      if (localStorage.getItem("lightbox_key_hint") === "seen") {
        keyHintShownRef.current = true;
        return;
      }
      localStorage.setItem("lightbox_key_hint", "seen");
    } catch {
      // localStorage unavailable — still show it this once
    }
    keyHintShownRef.current = true;
    setShowKeyHint(true);
    const t = setTimeout(() => setShowKeyHint(false), 3200);
    return () => clearTimeout(t);
  }, [selectedImageId]);

  const loadFavorites = (shareId: string) => {
    try {
      const stored = localStorage.getItem(`favorites_${shareId}`);
      if (stored) {
        setFavoriteIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // localStorage not available
    }
  };

  // Persist the current favorites set for this share (used by the optimistic
  // updates AND their failure reverts, so localStorage never disagrees).
  const persistFavorites = (shareId: string, favorites: Set<string>) => {
    try {
      localStorage.setItem(`favorites_${shareId}`, JSON.stringify([...favorites]));
    } catch {
      // localStorage not available
    }
  };

  // The heart flips optimistically; if the server write fails, flip it back
  // and say so — a silent failure here means the photographer never receives
  // the client's selections.
  const syncFavoriteToServer = (
    shareId: string,
    imageId: string,
    favorite: boolean
  ) => {
    fetch(`/api/gallery/${slug}/favorites`, {
      method: favorite ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, shareId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`favorites ${res.status}`);
      })
      .catch(() => {
        setFavoriteIds((prev) => {
          const reverted = new Set(prev);
          if (favorite) reverted.delete(imageId);
          else reverted.add(imageId);
          persistFavorites(shareId, reverted);
          return reverted;
        });
        toast.error("Couldn't save that favorite — please try again");
      });
  };

  const handleFavorite = async (imageId: string) => {
    if (!gallery) return;

    const newFavorites = new Set(favoriteIds);
    const isFavorited = newFavorites.has(imageId);

    if (isFavorited) {
      newFavorites.delete(imageId);
    } else {
      newFavorites.add(imageId);
    }
    syncFavoriteToServer(gallery.shareId, imageId, !isFavorited);

    setFavoriteIds(newFavorites);

    // G5: Favorite milestone toasts (photographer can turn these off per
    // event — corporate galleries find them off-brand)
    if (gallery.settings?.favoriteMilestones !== false) {
      const count = newFavorites.size;
      for (const threshold of [5, 10, 20]) {
        if (count >= threshold && !favoriteThresholdsRef.current.has(threshold)) {
          favoriteThresholdsRef.current.add(threshold);
          toast(`You've loved ${count} moments ❤️`, { duration: 3000 });
          break; // Only one toast per action
        }
      }
    }

    persistFavorites(gallery.shareId, newFavorites);
  };

  // Batch favorite/unfavorite — one state update for a whole smart stack.
  // (Looping handleFavorite would clobber itself: each call snapshots the
  // same favoriteIds closure, so only the last image would stick.)
  const handleFavoriteMany = (imageIds: string[], favorite: boolean) => {
    if (!gallery) return;

    const newFavorites = new Set(favoriteIds);
    for (const imageId of imageIds) {
      const has = newFavorites.has(imageId);
      if (favorite === has) continue; // already in the target state
      if (favorite) newFavorites.add(imageId);
      else newFavorites.delete(imageId);
      syncFavoriteToServer(gallery.shareId, imageId, favorite);
    }
    setFavoriteIds(newFavorites);

    if (gallery.settings?.favoriteMilestones !== false) {
      const count = newFavorites.size;
      for (const threshold of [5, 10, 20]) {
        if (count >= threshold && !favoriteThresholdsRef.current.has(threshold)) {
          favoriteThresholdsRef.current.add(threshold);
          toast(`You've loved ${count} moments ❤️`, { duration: 3000 });
          break;
        }
      }
    }

    persistFavorites(gallery.shareId, newFavorites);
  };

  const handlePasswordSuccess = () => {
    setIsLoading(true);
    fetchGallery();
  };

  /**
   * Poll a background ZIP build until it's ready, then hand the browser the
   * presigned R2 URL. One persistent toast tracks the whole wait.
   */
  const pollZipJob = (jobId: string, token: string | null, imageTotal?: number) => {
    if (zipPollRef.current) return; // one poller at a time
    zipPollRef.current = jobId;
    const toastId = `zip-${jobId}`;
    const startedAt = Date.now();
    // The build is server-side — the tab is only needed for the auto-start.
    const progressLabel = (done?: number, total?: number | null) => {
      const counts =
        total && done
          ? ` — ${done.toLocaleString()} of ${total.toLocaleString()} photos`
          : total
          ? ` — ${total.toLocaleString()} photos`
          : "";
      return `Preparing your gallery${counts}… You can keep browsing; the download starts automatically when it's ready.`;
    };
    toast.loading(progressLabel(undefined, imageTotal), {
      id: toastId,
      duration: Infinity,
    });
    const poll = async () => {
      if (zipPollRef.current !== jobId) return;
      try {
        const params = new URLSearchParams({ job: jobId });
        if (token) params.set("dt", token);
        const res = await fetch(
          `/api/gallery/${slug}/download/status?${params.toString()}`
        );
        const data = await res.json();
        if (data.status === "building" || data.status === "pending") {
          toast.loading(
            progressLabel(data.imagesDone, data.imageTotal ?? imageTotal),
            { id: toastId, duration: Infinity }
          );
        }
        if (data.status === "ready" && data.url) {
          zipPollRef.current = null;
          toast.success("Your download is starting", { id: toastId, duration: 5000 });
          window.location.href = data.url;
          return;
        }
        if (data.status === "error" || data.status === "expired" || !res.ok) {
          zipPollRef.current = null;
          toast.error(
            "We couldn't prepare that download — please try again.",
            { id: toastId, duration: 8000 }
          );
          return;
        }
      } catch {
        // transient network blip — keep polling
      }
      if (Date.now() - startedAt > 20 * 60 * 1000) {
        zipPollRef.current = null;
        toast.error("This is taking longer than expected — please try again.", {
          id: toastId,
          duration: 8000,
        });
        return;
      }
      setTimeout(poll, 4000);
    };
    setTimeout(poll, 4000);
  };

  /**
   * Start a bulk ZIP download (all / favorites / one section / one stack).
   * The query is what varies; PIN gating, the double-click guard, and the
   * "preparing" feedback are shared. Shows the PIN prompt first when
   * required, carrying the query through verification. The prepare endpoint
   * decides direct-stream (small) vs background build (large galleries used
   * to truncate or OOM when streamed synchronously).
   */
  const startBulkDownload = async (
    query: Record<string, string>,
    tokenOverride?: string | null
  ) => {
    if (!gallery) return;
    setDownloadMenuOpen(false);
    const token = tokenOverride ?? downloadToken;
    if (gallery.requirePinBulk && !token) {
      setPinAction({ type: "bulk", query });
      setShowPinModal(true);
      return;
    }
    // Guard against double-clicks firing two builds. The attachment response
    // doesn't unmount the page, so re-enable after a short cooldown.
    if (preparingDownload) return;
    setPreparingDownload(true);
    setTimeout(() => setPreparingDownload(false), 8000);
    try {
      const res = await fetch(`/api/gallery/${slug}/download/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...query, ...(token ? { dt: token } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Download failed — please try again.");
        return;
      }
      if (data.mode === "direct") {
        toast.success("Preparing your download…");
        const params = new URLSearchParams(query);
        if (token) params.set("dt", token);
        const qs = params.toString();
        window.location.href = `/api/gallery/${slug}/download${qs ? `?${qs}` : ""}`;
        return;
      }
      // Background build
      if (data.status === "ready" && data.url) {
        toast.success("Your download is starting");
        window.location.href = data.url;
        return;
      }
      pollZipJob(data.jobId, token, data.imageCount);
    } catch {
      toast.error("Download failed — please try again.");
    }
  };

  /** Attempt bulk download (all or favorites) -- shows PIN prompt if required */
  const handleDownloadAll = (favoritesOnly = false) => {
    startBulkDownload(favoritesOnly ? { favorites: "true" } : {});
  };

  /** Download every photo in a smart stack as one ZIP */
  const handleStackDownload = (stack: GalleryStack) => {
    startBulkDownload({
      images: stack.images.map((img) => img.id).join(","),
      name: stack.personName,
    });
  };

  /** Download the section the guest is currently viewing as one ZIP */
  const handleSectionDownload = () => {
    if (!activeSectionInfo || activeSectionInfo.id === "all") return;
    startBulkDownload({ section: activeSectionInfo.id });
  };

  /** Attempt individual download -- shows PIN prompt if required */
  const handleIndividualDownload = (image: GalleryImage) => {
    if (!gallery) return;
    if (gallery.requirePinIndividual && !downloadToken) {
      setPinAction({ type: "individual", image });
      setShowPinModal(true);
      return;
    }
    if (image.downloadUrl) {
      // Track download (fire-and-forget via sendBeacon)
      try {
        navigator.sendBeacon(
          `/api/gallery/${slug}/track`,
          new Blob(
            [JSON.stringify({ action: "image_download", imageId: image.id, shareId: gallery.shareId })],
            { type: "application/json" }
          )
        );
      } catch {
        /* sendBeacon not supported — non-critical */
      }
      const link = document.createElement("a");
      link.href = image.downloadUrl;
      link.download = image.originalFilename;
      link.click();
      toast.success("Downloaded", { description: image.originalFilename });
    }
  };

  /** Verify PIN against the server, then execute the pending action */
  const handlePinSubmit = async (pin: string) => {
    try {
      const res = await fetch(`/api/gallery/${slug}/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        toast.error("Incorrect PIN");
        return;
      }

      // PIN verified — keep the returned token for this session (bulk
      // downloads re-send it; the server re-checks on every request)
      const { downloadToken: token } = (await res.json()) as {
        downloadToken?: string;
      };
      if (token) setDownloadToken(token);
      setShowPinModal(false);

      // Execute the pending action with its original query intact (the token
      // rides along explicitly — state hasn't re-rendered yet)
      if (pinAction?.type === "bulk") {
        void startBulkDownload(pinAction.query, token ?? null);
      } else if (pinAction?.type === "individual" && pinAction.image.downloadUrl) {
        const link = document.createElement("a");
        link.href = pinAction.image.downloadUrl;
        link.download = pinAction.image.originalFilename;
        link.click();
      }
      setPinAction(null);
    } catch {
      toast.error("Failed to verify PIN");
    }
  };

  // Simple lightbox for gallery (no metadata panel)
  const selectedImage = gallery?.images.find((img) => img.id === selectedImageId);
  // Opened from a stack's mini gallery: navigate (and filmstrip) just that
  // stack, so the guest clearly stays inside one person's set.
  const stackNav =
    openStack &&
    selectedImageId &&
    openStack.images.some((img) => img.id === selectedImageId)
      ? openStack.images
      : null;
  // Otherwise navigate the on-screen list; if the open image just left the
  // visible set (e.g. a filter changed under the lightbox), fall back to the
  // full gallery so the arrows never dead-end.
  const navImages =
    stackNav ??
    (selectedImageId && !lightboxImages.some((img) => img.id === selectedImageId)
      ? gallery?.images ?? []
      : lightboxImages);
  const selectedIndex = navImages.findIndex((img) => img.id === selectedImageId);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-900 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[13px] text-stone-400">Loading gallery...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-8">
        <div className="text-center max-w-sm">
          <h1 className="font-editorial text-[28px] text-stone-900 mb-2">
            Gallery <span className="italic font-normal">unavailable</span>
          </h1>
          <p className="text-[14px] text-stone-400">{error}</p>
        </div>
      </div>
    );
  }

  // Password gate
  if (requiresAuth && authMeta) {
    return (
      <PasswordGate
        slug={slug}
        eventName={authMeta.eventName}
        customMessage={authMeta.customMessage}
        branding={authMeta.branding}
        hasCover={authMeta.hasCover}
        palette={authMeta.palette}
        onSuccess={handlePasswordSuccess}
      />
    );
  }

  if (!gallery) return null;

  const b = gallery.branding;
  const s = gallery.settings;

  // Stacks are the photographer's curation decision, so guests don't get to
  // switch them off wholesale — clicking a stack still expands it, which is the
  // escape hatch that actually matters ("where are the rest?").
  // Stacking one person into one tile is the thing we're avoiding.
  const stacksActive = !!s?.smartStacks && !singlePerson;

  // Resolve font classes
  const headingClass = HEADING_FONT_CLASS[s?.headingFont || "playfair"] || "font-editorial";
  const bodyClass = BODY_FONT_CLASS[s?.bodyFont || "inter"] || "font-sans";

  // Event-level color settings override branding defaults
  const colors = {
    primary: s?.colorPrimary || b?.primaryColor || "#1C1917",
    secondary: s?.colorSecondary || b?.secondaryColor || "#78716C",
    accent: s?.colorAccent || b?.accentColor || "#10B981",
    background: s?.colorBackground || b?.backgroundColor || "#FFFFFF",
  };

  // The lightbox tints to the gallery background (white by default) instead of a
  // hardcoded black. Pick readable foreground (ink vs white) from the bg's
  // luminance so controls/filename stay legible on any theme.
  const lightboxBg = colors.background;
  const isDarkBg = (() => {
    const hex = lightboxBg.replace("#", "");
    if (hex.length < 6) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const bl = parseInt(hex.slice(4, 6), 16);
    // Relative luminance (perceptual); < 0.5 → dark bg → light text.
    return (0.299 * r + 0.587 * g + 0.114 * bl) / 255 < 0.5;
  })();
  const lbFg = isDarkBg ? "#ffffff" : colors.primary;
  const lbFgMuted = isDarkBg ? "rgba(255,255,255,0.6)" : `${colors.secondary}`;

  // Cover — renderable per type (image needs its URL; mosaic/crossfade need photos)
  const coverType = s?.coverType ?? "image";
  const hasCover =
    !!s?.coverEnabled &&
    (coverType === "image"
      ? !!s?.coverImageUrl
      : coverType === "solid"
        ? !!s?.coverSolid
        : gallery.images.length > 0);
  const titlePosition = s?.titlePosition || "over";
  const titleAlignment = s?.titleAlignment || "center";
  // A client logo on the cover replaces the event title entirely
  const hideCoverTitle = hasCover && s?.coverShowsTitle === false;
  // When title is "over" the CoverSection renders the title — skip it in the header
  const coverRendersTitle = hasCover && titlePosition === "over" && !hideCoverTitle;
  const titleBelowCover = hasCover && titlePosition === "below" && !hideCoverTitle;
  const titleAboveCover = hasCover && titlePosition === "above" && !hideCoverTitle;
  const titleAlignClass = titleAlignment === "left" ? "text-left" : titleAlignment === "right" ? "text-right" : "text-center";

  // Build CSS custom properties from resolved colors
  const brandStyles = {
    "--brand-primary": colors.primary,
    "--brand-secondary": colors.secondary,
    "--brand-accent": colors.accent,
    "--brand-bg": colors.background,
  } as React.CSSProperties;

  return (
    <div className={`min-h-screen ${bodyClass}`} style={{ ...brandStyles, backgroundColor: colors.background }}>
      {/* ─── Logo + Title above cover ─── */}
      {titleAboveCover && (
        <div className="px-8 md:px-16 pt-12 pb-6">
          <div className={`flex items-center gap-6 ${titleAlignment === "left" ? "" : "flex-row-reverse"}`}>
            <h1
              className={`${headingClass} text-[clamp(28px,4vw,48px)] leading-[0.95] reveal flex-1 ${titleAlignClass}`}
              style={{ color: colors.primary }}
            >
              {singlePerson ?? gallery.eventName}
            </h1>
            {b && (b.logoUrl || b.businessName) && (
              <div className="flex items-center gap-3 shrink-0">
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Cover image ─── */}
      {hasCover && (
        <CoverSection
          settings={s!}
          images={gallery.images}
          sections={gallery.sections}
          eventName={gallery.eventName}
          headingClass={headingClass}
          primaryColor={colors.primary}
        />
      )}

      {/* ─── Branded header ─── */}
      <header className={`px-8 md:px-16 ${titleBelowCover || titleAboveCover ? "pt-6" : "pt-12"} pb-5`}>
        {/* Title/meta block (left) with Download across from it (top-right) */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
        {/* When title is below cover: logo + title inline */}
        {titleBelowCover ? (
          <div className={`flex items-center gap-6 ${titleAlignment === "left" ? "" : "flex-row-reverse"}`}>
            <h1
              className={`${headingClass} text-[clamp(28px,4vw,48px)] leading-[0.95] reveal flex-1 ${titleAlignClass}`}
              style={{ color: colors.primary }}
            >
              {singlePerson ?? gallery.eventName}
            </h1>
            {b && (b.logoUrl || b.businessName) && (
              <div className="flex items-center gap-3 shrink-0">
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Logo row — skip when above (already rendered above cover) */}
            {!titleAboveCover && b && (b.logoUrl || b.businessName) && (
              <div
                className={`flex items-center gap-3 mb-8 ${
                  b.logoPlacement === "center" ? "justify-center" : "justify-start"
                }`}
              >
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}

            {/* Title — skip when cover renders it, when above, or when a
                client logo on the cover IS the title */}
            {!coverRendersTitle && !titleAboveCover && !hideCoverTitle && (
              <h1
                className={`${headingClass} text-[clamp(32px,5vw,56px)] leading-[0.95] reveal`}
                style={{ color: colors.primary }}
              >
                {singlePerson ?? gallery.eventName}
              </h1>
            )}
          </>
        )}
        {gallery.eventDate && (
          <p className="caption-italic mt-2" style={{ color: colors.secondary }}>
            {new Date(gallery.eventDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              // event_date is a DATE (parsed as UTC midnight) — format in UTC
              // or US-timezone viewers see the previous day.
              timeZone: "UTC",
            })}
          </p>
        )}

        {/* ─── Active section label ─── */}
        {/* The section you're viewing, set in the accent color in the heading
            font — upright and a step smaller than the event title so it reads
            as a wayfinding label, not a flourish. Keyed by section id so it
            fades up on each change. Hidden while searching (sections aren't
            shown then). */}
        {!searchQuery.trim() && activeSectionInfo && (
          <div
            key={activeSectionInfo.id}
            className="reveal mt-2 flex items-baseline gap-3"
          >
            <span
              className={`${headingClass} leading-none text-[clamp(20px,2.6vw,32px)]`}
              style={{ color: colors.accent }}
            >
              {activeSectionInfo.name}
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.22em] tabular-nums"
              style={{ color: colors.accent, opacity: 0.55 }}
            >
              {activeSectionInfo.count}{" "}
              {activeSectionInfo.count === 1 ? "photo" : "photos"}
            </span>
          </div>
        )}
        {gallery.customMessage && (
          <p
            className="text-[14px] mt-4 max-w-2xl"
            style={{ color: colors.secondary }}
          >
            {gallery.customMessage}
          </p>
        )}
          </div>

          {/* Download menu (top-right, across from the title): All / Favorites */}
          {gallery.allowDownload && (
            <div className="relative shrink-0">
              <button
                onClick={() => setDownloadMenuOpen((o) => !o)}
                onBlur={() => setTimeout(() => setDownloadMenuOpen(false), 150)}
                className="flex items-center gap-2 px-4 py-2 text-[13px] transition-colors hover:bg-stone-50"
                style={{ color: colors.primary, border: `1px solid ${colors.secondary}30` }}
              >
                <Download className="h-4 w-4" strokeWidth={1.5} />
                Download
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              {downloadMenuOpen && (
                <div
                  className="absolute right-0 top-11 z-20 min-w-[190px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border bg-white py-1 shadow-lg"
                  style={{ borderColor: `${colors.secondary}1f` }}
                >
                  <button
                    onMouseDown={() => handleDownloadAll(false)}
                    className="block w-full px-4 py-2 text-left text-[13px] hover:bg-stone-50"
                    style={{ color: colors.primary }}
                  >
                    Download all
                  </button>
                  {/* Current section — only while a real section tab is active */}
                  {!searchQuery.trim() &&
                    activeSectionInfo &&
                    activeSectionInfo.id !== "all" && (
                      <button
                        onMouseDown={handleSectionDownload}
                        className="block w-full max-w-[260px] truncate px-4 py-2 text-left text-[13px] hover:bg-stone-50"
                        style={{ color: colors.primary }}
                        title={`Download the ${activeSectionInfo.count} photos in “${activeSectionInfo.name}” as a ZIP`}
                      >
                        Download &ldquo;{activeSectionInfo.name}&rdquo;
                      </button>
                    )}
                  {gallery.allowFavorites && (
                    <button
                      onMouseDown={() => handleDownloadAll(true)}
                      className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[13px] hover:bg-stone-50"
                      style={{ color: colors.primary }}
                    >
                      <Heart className="h-3.5 w-3.5" style={{ color: colors.accent }} fill={colors.accent} />
                      Download favorites
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div
        className="mx-8 md:mx-16 reveal-line"
        style={{ height: "1px", backgroundColor: `${colors.secondary}30` }}
      />

      {/* ─── Search + Sort + Gallery grid ─── */}
      <main className="px-8 md:px-16 pt-6 pb-24">
        {/* Toolbar: search + sort */}
        {gallery.images.length > 8 && (
          <div className="flex items-end justify-between gap-6 mb-8">
            {/* Search bar */}
            <div className="relative max-w-sm flex-1">
              <Search
                className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: colors.secondary }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  gallery.settings?.guestSearch === false
                    ? "Search photos…"
                    : 'Search photos — try "dancing" or a name…'
                }
                className="w-full pl-7 pr-8 py-2 text-[13px] bg-transparent border-b focus:outline-none transition-colors duration-300"
                style={{
                  color: colors.primary,
                  borderColor: searchQuery
                    ? colors.primary
                    : `${colors.secondary}40`,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-1 transition-colors"
                  style={{ color: colors.secondary }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {gallery.settings?.selfieSearch && (
              <button
                onClick={() => setSelfieOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 border text-[12px] tracking-wide transition-colors hover:opacity-70"
                style={{ color: colors.primary, borderColor: `${colors.secondary}60` }}
              >
                <ScanFace className="h-4 w-4" />
                Find my photos
              </button>
            )}
          </div>
        )}

        {/* ─── "Your photos" chip after a selfie match ─── */}
        {selfieMatches && !searchQuery.trim() && (
          <div className="mb-8 flex items-center gap-2 text-[12px]">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 border"
              style={{ color: colors.primary, borderColor: `${colors.secondary}60` }}
            >
              <ScanFace className="h-3 w-3" />
              Your photos
              <span style={{ color: colors.secondary }} className="tabular-nums">
                {selfieImages.length}
              </span>
            </span>
            <button
              onClick={() => setSelfieMatches(null)}
              aria-label="Show all photos"
              className="p-1 transition-colors hover:opacity-70"
              style={{ color: colors.secondary }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {selfieOpen && (
          <FindMyPhotos
            slug={slug}
            colors={colors}
            onResults={(ids) => {
              setSelfieMatches(ids);
              setSelfieOpen(false);
            }}
            onClose={() => setSelfieOpen(false)}
          />
        )}

        {/* When searching, show flat results; otherwise show sections */}
        {searchQuery.trim() ? (
          filteredImages.length > 0 ? (
            <>
              {semanticActive && (
                <p
                  className="text-center mb-6 text-[11px] uppercase tracking-[0.14em]"
                  style={{ color: colors.secondary }}
                >
                  Visual matches
                </p>
              )}
              <GalleryGrid
              images={filteredImages}
              allowDownload={gallery.allowDownload}
              allowFavorites={gallery.allowFavorites}
              favoriteIds={favoriteIds}
              onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
              onFavoriteMany={gallery.allowFavorites ? handleFavoriteMany : undefined}
              onImageClick={(id) => setSelectedImageId(id)}
              onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
              onOpenStack={setOpenStack}
              onDownloadStack={gallery.allowDownload ? handleStackDownload : undefined}
            celebrateFirstFavorite={favoriteIds.size === 0}
              gridStyle={s?.gridStyle}
              gridColumns={s?.gridColumns}
              gridGap={s?.gridGap}
              smartStacks={stacksActive}
              />
            </>
          ) : semanticLoading ? (
            <p
              className="text-center py-16 text-[14px] italic animate-pulse"
              style={{ color: colors.secondary }}
            >
              Looking for &ldquo;{searchQuery}&rdquo;…
            </p>
          ) : (
            <p
              className="text-center py-16 text-[14px] italic"
              style={{ color: colors.secondary }}
            >
              No photos match &ldquo;{searchQuery}&rdquo;
            </p>
          )
        ) : selfieMatches ? (
          <GalleryGrid
            images={selfieImages}
            allowDownload={gallery.allowDownload}
            allowFavorites={gallery.allowFavorites}
            favoriteIds={favoriteIds}
            onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
            onFavoriteMany={gallery.allowFavorites ? handleFavoriteMany : undefined}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
            onOpenStack={setOpenStack}
            onDownloadStack={gallery.allowDownload ? handleStackDownload : undefined}
            celebrateFirstFavorite={favoriteIds.size === 0}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
            smartStacks={false}
          />
        ) : gallery.sections && gallery.sections.length > 0 ? (
          <SectionedGallery
            images={gallery.images}
            sections={gallery.sections}
            allowDownload={gallery.allowDownload}
            allowFavorites={gallery.allowFavorites}
            favoriteIds={favoriteIds}
            onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
            onFavoriteMany={gallery.allowFavorites ? handleFavoriteMany : undefined}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
            onOpenStack={setOpenStack}
            onDownloadStack={gallery.allowDownload ? handleStackDownload : undefined}
            celebrateFirstFavorite={favoriteIds.size === 0}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
            defaultSort={s?.gridSort}
            smartStacks={stacksActive}
            colors={colors}
            onActiveSectionChange={setActiveSectionInfo}
            onVisibleImagesChange={setSectionVisibleImages}
          />
        ) : (
          <GalleryGrid
            images={gallery.images}
            allowDownload={gallery.allowDownload}
            allowFavorites={gallery.allowFavorites}
            favoriteIds={favoriteIds}
            onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
            onFavoriteMany={gallery.allowFavorites ? handleFavoriteMany : undefined}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
            onOpenStack={setOpenStack}
            onDownloadStack={gallery.allowDownload ? handleStackDownload : undefined}
            celebrateFirstFavorite={favoriteIds.size === 0}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
            smartStacks={stacksActive}
          />
        )}
      </main>

      {/* ─── Stack mini gallery (lightbox stacks on top at z-50) ─── */}
      {openStack && (
        <StackModal
          stack={openStack}
          colors={colors}
          headingClass={headingClass}
          allowFavorites={gallery.allowFavorites}
          favoriteIds={favoriteIds}
          onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
          onDownloadAll={gallery.allowDownload ? handleStackDownload : undefined}
          onImageClick={(id) => setSelectedImageId(id)}
          onClose={() => setOpenStack(null)}
          keyboardEnabled={!selectedImageId}
        />
      )}

      {/* ─── Simple gallery lightbox ─── */}
      {selectedImage && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center lightbox-open"
          style={{ backgroundColor: lightboxBg, color: lbFg }}
          onClick={() => setSelectedImageId(null)}
          onKeyDown={(e) => {
            // Arrows walk navImages — the on-screen section/search/sort view
            // (stack members adjacent), not the full gallery.
            if (e.key === "Escape") {
              setSelectedImageId(null);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              if (selectedIndex > 0) {
                setSelectedImageId(navImages[selectedIndex - 1].id);
              }
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              if (selectedIndex >= 0 && selectedIndex < navImages.length - 1) {
                setSelectedImageId(navImages[selectedIndex + 1].id);
              }
            }
          }}
        >
          {/* Navigation */}
          {selectedIndex > 0 && (
            <button
              aria-label="Previous image"
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 transition-opacity hover:opacity-100 z-10"
              style={{ color: lbFgMuted }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageId(navImages[selectedIndex - 1].id);
              }}
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={1.5} />
            </button>
          )}
          {selectedIndex >= 0 && selectedIndex < navImages.length - 1 && (
            <button
              aria-label="Next image"
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 transition-opacity hover:opacity-100 z-10"
              style={{ color: lbFgMuted }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageId(navImages[selectedIndex + 1].id);
              }}
            >
              <ChevronRight className="h-8 w-8" strokeWidth={1.5} />
            </button>
          )}

          {/* Close */}
          <button
            aria-label="Close image viewer"
            className="absolute top-4 right-4 p-3 transition-opacity hover:opacity-100 z-10"
            style={{ color: lbFgMuted }}
            onClick={() => setSelectedImageId(null)}
          >
            <X className="h-6 w-6" strokeWidth={1.5} />
          </button>

          {/* Image — show full-res original in lightbox */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage.originalUrl || selectedImage.thumbnailUrl}
            alt={selectedImage.parsedName || selectedImage.originalFilename}
            className="max-h-[90vh] max-w-[90vw] object-contain lightbox-image-enter"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Stack filmstrip — thumbnails of the person's other shots, so it's
              clear you're browsing inside a stack. Click to jump. */}
          {stackNav && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex max-w-[90vw] gap-1.5 overflow-x-auto px-2 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              {stackNav.map((img) => {
                const isActive = img.id === selectedImageId;
                return (
                  <button
                    key={img.id}
                    ref={(el) => {
                      if (el && isActive)
                        el.scrollIntoView({ block: "nearest", inline: "center" });
                    }}
                    onClick={() => setSelectedImageId(img.id)}
                    className="h-14 w-11 flex-shrink-0 overflow-hidden transition-opacity duration-200"
                    style={{
                      opacity: isActive ? 1 : 0.45,
                      outline: isActive ? `2px solid ${colors.accent}` : "none",
                      outlineOffset: "-2px",
                    }}
                    aria-label={`View photo ${img.originalFilename}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Bottom bar — lifted above the filmstrip when inside a stack */}
          <div
            className={`absolute ${stackNav ? "bottom-24" : "bottom-4"} left-1/2 -translate-x-1/2 flex items-center gap-4 z-10`}
          >
            {gallery.allowFavorites && (
              <button
                className="p-2.5 backdrop-blur-sm transition-opacity hover:opacity-100"
                style={{
                  color: favoriteIds.has(selectedImage.id) ? colors.accent : lbFgMuted,
                  backgroundColor: isDarkBg ? "rgba(255,255,255,0.1)" : `${colors.secondary}14`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (favoriteIds.size === 0 && !favoriteIds.has(selectedImage.id)) {
                    pixelBurstAt(e.clientX, e.clientY); // D2: first favorite
                  }
                  handleFavorite(selectedImage.id);
                }}
              >
                <Heart className="h-5 w-5" fill={favoriteIds.has(selectedImage.id) ? "currentColor" : "none"} strokeWidth={1.5} />
              </button>
            )}
            {gallery.allowDownload && selectedImage.downloadUrl && (
              <button
                className="p-2.5 backdrop-blur-sm transition-opacity hover:opacity-100"
                style={{
                  color: lbFgMuted,
                  backgroundColor: isDarkBg ? "rgba(255,255,255,0.1)" : `${colors.secondary}14`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleIndividualDownload(selectedImage);
                }}
              >
                <Download className="h-5 w-5" strokeWidth={1.5} />
              </button>
            )}
          </div>

          {/* First-open keyboard hint — fades after a moment, never again */}
          {showKeyHint && navImages.length > 1 && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-10 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] backdrop-blur-sm pointer-events-none reveal"
              style={{
                bottom: stackNav ? "8.5rem" : "4.5rem",
                color: lbFgMuted,
                backgroundColor: isDarkBg
                  ? "rgba(255,255,255,0.08)"
                  : `${colors.secondary}14`,
              }}
            >
              ← → to navigate
            </div>
          )}

          {/* Counter + filename (+ stack context when inside one) */}
          <div className="absolute top-4 left-4">
            <p className="text-[12px] tabular-nums" style={{ color: lbFgMuted, opacity: 0.7 }}>
              {selectedIndex + 1} / {navImages.length}
              {stackNav && openStack && (
                <span className="ml-2 not-italic">· {openStack.personName}</span>
              )}
            </p>
            {selectedImage.originalFilename && (
              <p className="text-[13px] mt-1 max-w-[280px] truncate" style={{ color: lbFgMuted }}>
                {selectedImage.originalFilename}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ─── End-of-gallery moment ─── */}
      {b && (
        <div className="py-16 text-center stagger-in">
          {b.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={b.logoUrl}
              alt={b.businessName || ""}
              className="h-12 w-auto object-contain mx-auto mb-4 opacity-60"
            />
          )}
          <p className="text-[13px] text-stone-400 tracking-wide uppercase">
            Photographed by
          </p>
          <p className="font-editorial italic text-[22px] text-stone-700 mt-1">
            {b.businessName || "Your Photographer"}
          </p>
          {b.website && (
            <a
              href={b.website.startsWith("http") ? b.website : `https://${b.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-[12px] text-stone-400 hover:text-stone-600 transition-colors duration-300 border-b border-stone-200 hover:border-stone-400 pb-0.5"
            >
              View Portfolio →
            </a>
          )}
        </div>
      )}

      {/* ─── Footer — powered-by only. The end-of-gallery moment above
          already credits the photographer (logo, name, portfolio link);
          repeating them here read as a duplicate credit block (audit #16). ─── */}
      <footer className="px-8 md:px-16 pt-4 pb-8">
        <hr
          className="mb-8 border-0 h-px"
          style={{ backgroundColor: `${colors.secondary}20` }}
        />
        <div className="flex items-center justify-center">
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: colors.secondary }}>
            Powered by{" "}
            {/* Pixel-mosaic favicon */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="opacity-40">
              <rect x="0" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
              <rect x="4" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
              <rect x="8" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="12" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.2" />
              <rect x="0" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="4" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.9" />
              <rect x="8" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.7" />
              <rect x="12" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
              <rect x="0" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="4" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.7" />
              <rect x="8" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.8" />
              <rect x="12" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="0" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.2" />
              <rect x="4" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="8" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="12" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.9" />
            </svg>
            <span className="font-brand text-[13px]" style={{ color: colors.primary }}>
              pixeltrunk
            </span>
          </p>
        </div>
      </footer>

      {/* ─── PIN prompt modal ─── */}
      {showPinModal && (
        <PinPromptModal
          onSubmit={handlePinSubmit}
          onClose={() => {
            setShowPinModal(false);
            setPinAction(null);
          }}
        />
      )}
    </div>
  );
}

