"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface RecentFailure {
  id: string;
  lastError: string | null;
  originalFilename: string;
}

interface ProcessingStatus {
  total: number;
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  recentFailures: RecentFailure[];
}

interface UseProcessingStatusReturn extends ProcessingStatus {
  isProcessing: boolean;
}

const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;
const POLL_GROWTH = 1.5;

/**
 * useProcessingStatus — polls the processing-status endpoint for an event.
 *
 * - Single combined RPC per poll (was four COUNT round-trips).
 * - Exponential backoff up to 30s once nothing is changing.
 * - Auto-restarts polling when the in-flight totals change (e.g. user
 *   uploads more photos after the first batch finished).
 * - Surfaces recent failures so the UI can show what's wrong instead of a
 *   stuck spinner.
 */
export function useProcessingStatus(
  eventId: string,
  enabled: boolean
): UseProcessingStatusReturn {
  const [status, setStatus] = useState<ProcessingStatus>({
    total: 0,
    pending: 0,
    processing: 0,
    complete: 0,
    failed: 0,
    recentFailures: [],
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalMsRef = useRef<number>(MIN_POLL_MS);
  const lastSnapshotRef = useRef<string>("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/processing-status`);
      if (!res.ok) return null;
      return (await res.json()) as ProcessingStatus;
    } catch {
      return null;
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      const next = await fetchStatus();
      if (cancelled) return;

      if (next) {
        setStatus(next);
        const snapshot = `${next.pending}-${next.processing}-${next.complete}-${next.failed}`;
        if (snapshot !== lastSnapshotRef.current) {
          // Something changed — reset to fast polling.
          intervalMsRef.current = MIN_POLL_MS;
          lastSnapshotRef.current = snapshot;
        }

        const stillWorking = next.pending + next.processing > 0;
        if (!stillWorking) {
          // Nothing in flight; back off generously. We still want to keep
          // checking in case the user uploads more or something flips to
          // failed, but not aggressively.
          intervalMsRef.current = Math.min(
            intervalMsRef.current * POLL_GROWTH,
            MAX_POLL_MS
          );
        }
      } else {
        // Network/error — back off but stay alive.
        intervalMsRef.current = Math.min(
          intervalMsRef.current * POLL_GROWTH,
          MAX_POLL_MS
        );
      }

      timerRef.current = setTimeout(tick, intervalMsRef.current);
    };

    intervalMsRef.current = MIN_POLL_MS;
    void tick();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, fetchStatus]);

  const isProcessing = status.pending + status.processing > 0;

  return {
    ...status,
    isProcessing,
  };
}
