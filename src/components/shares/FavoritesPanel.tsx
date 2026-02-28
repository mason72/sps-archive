"use client";

import { useState, useEffect } from "react";
import { Heart, Mail, User } from "lucide-react";

interface ClientFavorites {
  name: string;
  email: string | null;
  favoriteCount: number;
  imageIds: string[];
  shareSlug: string;
  lastActivity: string;
}

interface FavoritesPanelProps {
  eventId: string;
}

/**
 * FavoritesPanel — Photographer view of client picks.
 * Shows favorites grouped by client across all shares.
 */
export function FavoritesPanel({ eventId }: FavoritesPanelProps) {
  const [clients, setClients] = useState<ClientFavorites[]>([]);
  const [totalFavorites, setTotalFavorites] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/events/${eventId}/favorites`);
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setClients(data.clients);
        setTotalFavorites(data.totalFavorites);
      } catch (error) {
        console.error("Load favorites error:", error);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [eventId]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse bg-stone-50" />
        <div className="h-16 animate-pulse bg-stone-50" />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="py-12 text-center">
        <Heart className="h-8 w-8 text-stone-200 mx-auto mb-3" />
        <p className="text-[14px] text-stone-400">No favorites yet</p>
        <p className="text-[12px] text-stone-300 mt-1">
          Client picks will appear here once they start favoriting
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400">
          Client Picks
        </h3>
        <span className="text-[12px] text-stone-400 tabular-nums">
          {totalFavorites} total
        </span>
      </div>

      <div className="space-y-3">
        {clients.map((client, i) => (
          <div
            key={i}
            className="border border-stone-100 p-4 hover:border-stone-200 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-stone-400" />
                  <span className="text-[14px] font-medium text-stone-800">
                    {client.name}
                  </span>
                </div>
                {client.email && (
                  <div className="flex items-center gap-2 mt-1">
                    <Mail className="h-3 w-3 text-stone-300" />
                    <span className="text-[12px] text-stone-400">
                      {client.email}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-accent">
                <Heart className="h-3.5 w-3.5" fill="currentColor" />
                <span className="text-[13px] font-medium tabular-nums">
                  {client.favoriteCount}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-stone-300">
              Last pick:{" "}
              {new Date(client.lastActivity).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
