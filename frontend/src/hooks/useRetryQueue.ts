// Auto-retry hook for the queued finalize calls. Listens for the
// 'online' window event and for explicit user-triggered retries. Reports
// each outcome to the caller via the onFlush callback so the UI can
// surface specific server-side failures (insufficient_stock, eod_signed_off).

import { useCallback, useEffect, useRef, useState } from "react";
import { flushQueue, listQueued, type FlushOutcome } from "../api/finalize-queue";
import { useOnlineStatus } from "./useOnlineStatus";

export interface UseRetryQueueOptions {
  onFlush?: (outcomes: FlushOutcome[]) => void;
  pollIntervalMs?: number;
}

export interface UseRetryQueueResult {
  online: boolean;
  pending: number;
  flush: () => Promise<FlushOutcome[]>;
}

export function useRetryQueue(options: UseRetryQueueOptions = {}): UseRetryQueueResult {
  const online = useOnlineStatus();
  const [pending, setPending] = useState<number>(() => listQueued().length);
  const flushing = useRef(false);
  const onFlushRef = useRef(options.onFlush);
  onFlushRef.current = options.onFlush;

  const flush = useCallback(async (): Promise<FlushOutcome[]> => {
    if (flushing.current) return [];
    flushing.current = true;
    try {
      const outcomes = await flushQueue();
      setPending(listQueued().length);
      if (outcomes.length > 0) onFlushRef.current?.(outcomes);
      return outcomes;
    } finally {
      flushing.current = false;
    }
  }, []);

  // Auto-flush when we transition from offline -> online.
  useEffect(() => {
    if (online && pending > 0) {
      void flush();
    }
    // We intentionally don't include `pending` or `flush` in deps — we
    // want the effect to run only when `online` flips, then read fresh
    // pending via listQueued inside flush().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Optional light polling so a missed 'online' event still picks up.
  useEffect(() => {
    if (!options.pollIntervalMs) return;
    const t = window.setInterval(() => setPending(listQueued().length), options.pollIntervalMs);
    return () => window.clearInterval(t);
  }, [options.pollIntervalMs]);

  return { online, pending, flush };
}