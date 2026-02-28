"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Link2,
  Copy,
  Trash2,
  Mail,
} from "lucide-react";

interface MoreMenuProps {
  eventId: string;
  eventName: string;
  shareSlug?: string;
  onShowEmails?: () => void;
}

/**
 * MoreMenu — Dropdown menu for event-level actions.
 * Appears anchored to a "•••" button in the event nav.
 */
export function MoreMenu({
  eventId,
  eventName,
  shareSlug,
  onShowEmails,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const copyDirectLink = async () => {
    const url = shareSlug
      ? `${window.location.origin}/g/${shareSlug}`
      : window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => {
      setCopied(false);
      setOpen(false);
    }, 1200);
  };

  const duplicateEvent = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to duplicate");
      const data = await res.json();
      toast.success("Event duplicated");
      router.push(`/events/${data.event.id}`);
    } catch (err) {
      console.error("Duplicate failed:", err);
      toast.error("Failed to duplicate event");
    }
  };

  const deleteEvent = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Event deleted");
      router.push("/");
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error("Failed to delete event");
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          setConfirmDelete(false);
        }}
        className="text-stone-400 hover:text-stone-700 transition-colors duration-300 p-1"
        aria-label="More actions"
      >
        <MoreHorizontal size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-stone-200 shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Copy direct link */}
          <button
            onClick={copyDirectLink}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors text-left"
          >
            {copied ? (
              <>
                <Link2 size={14} className="text-accent" />
                <span className="text-accent">Copied!</span>
              </>
            ) : (
              <>
                <Link2 size={14} />
                Get direct link
              </>
            )}
          </button>

          {/* Email history */}
          <button
            onClick={() => {
              setOpen(false);
              onShowEmails?.();
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors text-left"
          >
            <Mail size={14} />
            Email history
          </button>

          {/* Duplicate */}
          <button
            onClick={duplicateEvent}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors text-left"
          >
            <Copy size={14} />
            Duplicate event
          </button>

          <div className="my-1 mx-3 border-t border-stone-100" />

          {/* Delete */}
          {confirmDelete ? (
            <button
              onClick={deleteEvent}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors text-left"
            >
              <Trash2 size={14} />
              Click again to confirm delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-stone-700 hover:bg-stone-50 hover:text-red-600 transition-colors text-left"
            >
              <Trash2 size={14} />
              Delete event
            </button>
          )}
        </div>
      )}
    </div>
  );
}
