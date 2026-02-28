"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

const EVENT_TYPES = [
  { value: "wedding", label: "Wedding" },
  { value: "headshot", label: "Headshots" },
  { value: "corporate", label: "Corporate" },
  { value: "portrait", label: "Portraits" },
  { value: "sports", label: "Sports" },
  { value: "school", label: "School" },
  { value: "other", label: "Other" },
];

interface Template {
  id: string;
  name: string;
  description: string | null;
  event_type: string | null;
  settings: Record<string, unknown>;
  sections: { name: string; description?: string; sortOrder: number }[];
}

export default function NewEventPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateSettings, setTemplateSettings] = useState<Record<string, unknown> | null>(null);
  const [templateSections, setTemplateSections] = useState<
    { name: string; description?: string; sortOrder: number }[] | null
  >(null);

  // Fetch templates on mount
  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch("/api/templates");
        if (!res.ok) return;
        const { templates: data } = await res.json();
        setTemplates(data || []);
      } catch {
        // Templates are optional — silently skip
      }
    }
    loadTemplates();
  }, []);

  const handleSelectTemplate = (template: Template) => {
    if (selectedTemplateId === template.id) {
      // Deselect
      setSelectedTemplateId(null);
      setEventType("");
      setTemplateSettings(null);
      setTemplateSections(null);
      return;
    }

    setSelectedTemplateId(template.id);
    if (template.event_type) {
      setEventType(template.event_type);
    }
    setTemplateSettings(template.settings || null);
    setTemplateSections(
      Array.isArray(template.sections) && template.sections.length > 0
        ? template.sections
        : null
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          eventType: eventType || undefined,
          eventDate: eventDate || undefined,
          settings: templateSettings || undefined,
          sections: templateSections || undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to create event");

      const { event } = await response.json();
      router.push(`/events/${event.id}`);
    } catch (error) {
      console.error("Create event error:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* ─── Nav ─── */}
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
        <Link href="/" className="font-editorial text-[28px] text-stone-900">
          Prism
        </Link>
        <div className="flex items-center gap-10 text-[13px] tracking-wide">
          <Link href="/" className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300">
            Archive
          </Link>
          <Link href="/events/new" className="editorial-link font-medium text-stone-900">
            New Event
          </Link>
        </div>
      </nav>

      <div className="mx-8 md:mx-16 rule reveal-line" />

      <main className="px-8 md:px-16 pt-16 pb-24 max-w-2xl">
        <p
          className="label-caps mb-4 reveal"
          style={{ animationDelay: "0.1s" }}
        >
          New event
        </p>
        <h1
          className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 mb-4 reveal"
          style={{ animationDelay: "0.15s" }}
        >
          Begin a new{" "}
          <span className="italic font-serif font-normal">chapter</span>
        </h1>
        <p
          className="text-stone-400 text-[15px] max-w-md leading-[1.8] mb-16 reveal"
          style={{ animationDelay: "0.2s" }}
        >
          Name your event and start uploading. AI handles the rest.
        </p>

        {/* ─── Templates ─── */}
        {templates.length > 0 && (
          <div
            className="mb-16 reveal"
            style={{ animationDelay: "0.22s" }}
          >
            <label className="label-caps mb-2 block">
              Start from template
            </label>
            <p className="text-[13px] text-stone-400 mb-4">
              Pre-fill settings from a saved configuration
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl)}
                  className={cn(
                    "border p-4 text-left cursor-pointer transition-colors",
                    selectedTemplateId === tpl.id
                      ? "border-stone-900 bg-stone-50"
                      : "border-stone-200 hover:border-stone-400"
                  )}
                >
                  <span className="text-[14px] text-stone-900 font-medium block">
                    {tpl.name}
                  </span>
                  {tpl.description && (
                    <span className="text-[12px] text-stone-400 block mt-1">
                      {tpl.description}
                    </span>
                  )}
                  {tpl.event_type && (
                    <span className="label-caps text-accent mt-2 inline-block">
                      {tpl.event_type}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="space-y-12 reveal"
          style={{ animationDelay: "0.25s" }}
        >
          {/* Event name */}
          <div>
            <label htmlFor="name" className="label-caps mb-3 block">
              Event name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Johnson Wedding, Q1 Headshots"
              required
              autoFocus
              className="h-12 w-full border-b border-stone-200 bg-transparent text-[18px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>

          {/* Event type */}
          <div>
            <label className="label-caps mb-2 block">Event type</label>
            <p className="text-[13px] text-stone-400 mb-4">
              Helps AI choose scene categories and stacking strategy
            </p>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setEventType(eventType === type.value ? "" : type.value)
                  }
                  className={cn(
                    "px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border transition-all duration-300",
                    eventType === type.value
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-700"
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Event date */}
          <div>
            <label className="label-caps mb-3 block">
              Date
              <span className="ml-2 normal-case tracking-normal text-stone-300 text-[11px]">
                optional
              </span>
            </label>
            <DatePicker value={eventDate} onChange={setEventDate} />
          </div>

          <Button type="submit" size="lg" disabled={!name.trim() || isCreating}>
            {isCreating ? "Creating..." : "Create event & start uploading"}
          </Button>
        </form>
      </main>
    </div>
  );
}
