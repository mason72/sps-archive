"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Heart,
  Eye,
  Mail,
  Link2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "shares" | "favorites" | "emails";

interface ActivitiesPanelProps {
  eventId: string;
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
}

interface ShareActivity {
  id: string;
  slug: string;
  shareType: string;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  allowDownload: boolean;
  allowFavorites: boolean;
}

interface FavoriteClient {
  name: string | null;
  email: string | null;
  favoriteCount: number;
  lastActivity: string;
}

interface EmailSend {
  id: string;
  subject: string;
  recipients: string[];
  status: string;
  sentAt: string;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "shares", label: "Share Links", icon: <Link2 size={14} /> },
  { id: "favorites", label: "Favorites", icon: <Heart size={14} /> },
  { id: "emails", label: "Emails", icon: <Mail size={14} /> },
];

/**
 * ActivitiesPanel — Slide-in panel showing event activity.
 * Tabs: Share Links, Favorites, Emails
 */
export function ActivitiesPanel({
  eventId,
  open,
  onClose,
  initialTab = "shares",
}: ActivitiesPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [shares, setShares] = useState<ShareActivity[]>([]);
  const [clients, setClients] = useState<FavoriteClient[]>([]);
  const [emails, setEmails] = useState<EmailSend[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Reset tab when panel opens with specific initial tab
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Fetch data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sharesRes, favoritesRes, emailsRes] = await Promise.all([
        fetch(`/api/events/${eventId}/shares`),
        fetch(`/api/events/${eventId}/favorites`),
        fetch(`/api/events/${eventId}/emails`),
      ]);

      if (sharesRes.ok) {
        const data = await sharesRes.json();
        setShares(data.shares || []);
      }

      if (favoritesRes.ok) {
        const data = await favoritesRes.json();
        setClients(data.clients || []);
      }

      if (emailsRes.ok) {
        const data = await emailsRes.json();
        setEmails(data.sends || []);
      }
    } catch (err) {
      console.error("Load activities failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const relTime = (d: string | null) => {
    if (!d) return "Never";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(d).toLocaleDateString();
  };

  const panel = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white z-50 border-l border-stone-200 shadow-2xl flex flex-col panel-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-stone-200">
          <h2 className="font-editorial text-[20px] text-stone-900">
            Activity
          </h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] uppercase tracking-[0.15em] font-medium transition-all duration-300 border-b-2",
                activeTab === tab.id
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-16 text-center">
              <p className="text-[13px] text-stone-400">Loading…</p>
            </div>
          ) : (
            <>
              {activeTab === "shares" && (
                <SharesTab shares={shares} relTime={relTime} />
              )}
              {activeTab === "favorites" && (
                <FavoritesTab clients={clients} relTime={relTime} />
              )}
              {activeTab === "emails" && (
                <EmailsTab emails={emails} relTime={relTime} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}

/* ─── Share Links Tab ─── */
function SharesTab({
  shares,
  relTime,
}: {
  shares: ShareActivity[];
  relTime: (d: string | null) => string;
}) {
  if (shares.length === 0) {
    return (
      <EmptyState icon={<Link2 size={28} />} message="No share links yet" />
    );
  }

  return (
    <div className="divide-y divide-stone-100">
      {shares.map((share) => (
        <div key={share.id} className="px-6 py-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-stone-500 bg-stone-50 px-2 py-0.5">
                /{share.slug}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-stone-400">
                {share.shareType}
              </span>
            </div>
            <a
              href={`/g/${share.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-stone-400 hover:text-accent transition-colors"
            >
              <ExternalLink size={12} />
            </a>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-stone-400">
            <span className="flex items-center gap-1">
              <Eye size={11} />
              {share.viewCount} views
            </span>
            <span>Last viewed: {relTime(share.lastViewedAt)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-stone-300">
            {share.allowDownload && <span>Downloads ✓</span>}
            {share.allowFavorites && <span>Favorites ✓</span>}
            <span>Created {relTime(share.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Favorites Tab ─── */
function FavoritesTab({
  clients,
  relTime,
}: {
  clients: FavoriteClient[];
  relTime: (d: string | null) => string;
}) {
  if (clients.length === 0) {
    return (
      <EmptyState icon={<Heart size={28} />} message="No favorites yet" />
    );
  }

  return (
    <div className="divide-y divide-stone-100">
      {clients.map((client, i) => (
        <div key={i} className="px-6 py-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[14px] font-medium text-stone-900">
              {client.name || "Anonymous"}
            </span>
            <span className="text-[12px] text-stone-400">
              {relTime(client.lastActivity)}
            </span>
          </div>
          {client.email && (
            <p className="text-[12px] text-stone-400 mb-1">{client.email}</p>
          )}
          <p className="text-[12px] text-accent font-medium">
            {client.favoriteCount} favorite{client.favoriteCount !== 1 ? "s" : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Emails Tab ─── */
function EmailsTab({
  emails,
  relTime,
}: {
  emails: EmailSend[];
  relTime: (d: string | null) => string;
}) {
  if (emails.length === 0) {
    return (
      <EmptyState icon={<Mail size={28} />} message="No emails sent yet" />
    );
  }

  return (
    <div className="divide-y divide-stone-100">
      {emails.map((send) => (
        <div key={send.id} className="px-6 py-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[14px] font-medium text-stone-900 truncate flex-1 mr-4">
              {send.subject}
            </span>
            <span className="text-[12px] text-stone-400 shrink-0">
              {relTime(send.sentAt)}
            </span>
          </div>
          <p className="text-[12px] text-stone-400 truncate">
            To: {(send.recipients || []).join(", ")}
          </p>
          <span
            className={cn(
              "inline-block mt-1 text-[10px] uppercase tracking-widest px-1.5 py-0.5",
              send.status === "sent"
                ? "text-accent bg-accent/10"
                : send.status === "preview"
                  ? "text-stone-500 bg-stone-100"
                  : "text-red-500 bg-red-50"
            )}
          >
            {send.status}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Empty State ─── */
function EmptyState({
  icon,
  message,
}: {
  icon: React.ReactNode;
  message: string;
}) {
  return (
    <div className="py-16 text-center">
      <div className="text-stone-200 mb-3 flex justify-center">{icon}</div>
      <p className="text-[13px] text-stone-400">{message}</p>
    </div>
  );
}
