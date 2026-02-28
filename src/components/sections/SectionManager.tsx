"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Plus, FolderOpen } from "lucide-react";
import { SectionRow } from "./SectionRow";
import { Button } from "@/components/ui/button";

interface SectionItem {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
  sortOrder?: number;
}

interface SectionManagerProps {
  eventId: string;
  sections: SectionItem[];
  onSectionsChange: (sections: SectionItem[]) => void;
  onClose: () => void;
}

export function SectionManager({
  eventId,
  sections,
  onSectionsChange,
  onClose,
}: SectionManagerProps) {
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // ─── Create section ───
  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, name: trimmed }),
      });

      if (!res.ok) throw new Error("Failed to create section");

      const data = await res.json();
      onSectionsChange([...sections, {
        id: data.section.id,
        name: data.section.name,
        isAuto: data.section.isAuto,
        imageCount: 0,
      }]);
      setNewName("");
      toast.success("Section created");
    } catch (err) {
      console.error("Create section failed:", err);
      toast.error("Failed to create section");
    } finally {
      setIsCreating(false);
    }
  }, [eventId, newName, sections, onSectionsChange]);

  // ─── Rename section ───
  const handleRename = useCallback(
    async (sectionId: string, name: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (!res.ok) throw new Error("Failed to rename section");

        onSectionsChange(
          sections.map((s) => (s.id === sectionId ? { ...s, name } : s))
        );
        toast.success("Section renamed");
      } catch (err) {
        console.error("Rename section failed:", err);
        toast.error("Failed to rename section");
      }
    },
    [sections, onSectionsChange]
  );

  // ─── Delete section ───
  const handleDelete = useCallback(
    async (sectionId: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`, {
          method: "DELETE",
        });

        if (!res.ok) throw new Error("Failed to delete section");

        onSectionsChange(sections.filter((s) => s.id !== sectionId));
        toast.success("Section deleted");
      } catch (err) {
        console.error("Delete section failed:", err);
        toast.error("Failed to delete section");
      }
    },
    [sections, onSectionsChange]
  );

  // ─── Drag-and-drop reorder ───
  const handleDragOver = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex) return;

      const reordered = [...sections];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(targetIndex, 0, moved);

      onSectionsChange(reordered);
      setDragIndex(targetIndex);
    },
    [dragIndex, sections, onSectionsChange]
  );

  const handleDragEnd = useCallback(async () => {
    setDragIndex(null);

    // Persist new order to backend
    try {
      await fetch("/api/sections/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sectionIds: sections.map((s) => s.id),
        }),
      });
      toast.success("Sections reordered");
    } catch (err) {
      console.error("Reorder sections failed:", err);
      toast.error("Failed to reorder sections");
    }
  }, [eventId, sections]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") setNewName("");
  };

  const panel = (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px] lightbox-open"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-[400px] bg-white shadow-2xl panel-slide-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <FolderOpen size={18} className="text-stone-400" />
            <h2 className="font-editorial text-[20px] text-stone-900">
              Sections
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Section list */}
        <div className="flex-1 overflow-y-auto">
          {sections.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FolderOpen
                size={32}
                className="text-stone-200 mx-auto mb-3"
              />
              <p className="text-[13px] text-stone-400">
                No sections yet
              </p>
              <p className="text-[12px] text-stone-300 mt-1">
                Create a section to organize your gallery
              </p>
            </div>
          ) : (
            sections.map((section, index) => (
              <SectionRow
                key={section.id}
                id={section.id}
                name={section.name}
                isAuto={section.isAuto}
                imageCount={section.imageCount}
                onRename={handleRename}
                onDelete={handleDelete}
                isDragging={dragIndex === index}
                onDragStart={() => setDragIndex(index)}
                onDragEnd={handleDragEnd}
                onDragOver={() => handleDragOver(index)}
              />
            ))
          )}
        </div>

        {/* Create new section */}
        <div className="border-t border-stone-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <Plus size={16} className="text-stone-300 shrink-0" />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="New section name…"
              className="flex-1 text-[13px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-1.5 transition-colors"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim() || isCreating}
            >
              {isCreating ? "…" : "Add"}
            </Button>
          </div>
          <p className="text-[11px] text-stone-300 mt-2">
            Drag sections to reorder. Auto-generated sections are marked with ✦.
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(panel, document.body);
}
