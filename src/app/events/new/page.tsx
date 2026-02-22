"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const EVENT_TYPES = [
  { value: "wedding", label: "Wedding" },
  { value: "headshot", label: "Headshots" },
  { value: "corporate", label: "Corporate Event" },
  { value: "portrait", label: "Portraits" },
  { value: "sports", label: "Sports" },
  { value: "school", label: "School" },
  { value: "other", label: "Other" },
];

export default function NewEventPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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
          description: description.trim() || undefined,
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
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-16 max-w-2xl items-center px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create new event
        </h1>
        <p className="mt-1 text-stone-500">
          Set up your event, then upload photos. AI will do the rest.
        </p>

        <form onSubmit={handleCreate} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-stone-700"
            >
              Event name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Johnson Wedding, Q1 Headshots"
              required
              className="mt-1.5 h-11 w-full rounded-lg border border-stone-300 px-3 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
            />
          </div>

          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-stone-700"
            >
              Event type
            </label>
            <p className="text-xs text-stone-400">
              Helps AI choose the right scene categories and stacking strategy
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EVENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setEventType(eventType === type.value ? "" : type.value)
                  }
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    eventType === type.value
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-300 text-stone-600 hover:border-stone-400 hover:text-stone-900"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="date"
              className="block text-sm font-medium text-stone-700"
            >
              Event date
              <span className="ml-1 text-stone-400">(optional)</span>
            </label>
            <input
              id="date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-stone-300 px-3 text-stone-900 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-stone-700"
            >
              Notes
              <span className="ml-1 text-stone-400">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Any notes about this event..."
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
            />
          </div>

          <Button type="submit" size="lg" disabled={!name.trim() || isCreating}>
            {isCreating ? "Creating..." : "Create event & upload photos"}
          </Button>
        </form>
      </main>
    </div>
  );
}
