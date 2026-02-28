"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ProcessingStatus {
  total: number;
  pending: number;
  processing: number;
  complete: number;
  failed: number;
}

interface UseProcessingStatusReturn extends ProcessingStatus {
  isProcessing: boolean;
}

const POLL_INTERVAL = 5000;

/**
 * useProcessingStatus — Polls the processing status API for an event.
 * Auto-stops polling when all images are complete (or there are none).
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
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/events/${eventId}/processing-status`
      );
      if (!res.ok) return;
      const data: ProcessingStatus = await res.json();
      setStatus(data);
    } catch {
      // Silently ignore fetch errors during polling
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;

    // Fetch immediately on mount
    fetchStatus();

    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, fetchStatus]);

  const isProcessing = status.pending + status.processing > 0;

  // Stop polling once processing is done
  useEffect(() => {
    if (!isProcessing && status.total > 0 && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [isProcessing, status.total]);

  return {
    ...status,
    isProcessing,
  };
}
