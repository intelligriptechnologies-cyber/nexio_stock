// Connectivity tracker that distinguishes browser connectivity hints from
// actual API reachability. We probe /healthz so a down backend still shows
// "No network", and we delay the offline transition briefly to avoid UI
// flicker during short drops.

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../api/client";

export type ConnectivityStatus = "checking" | "online" | "offline";

export interface ConnectivitySnapshot {
  status: ConnectivityStatus;
  online: boolean;
  probe: () => Promise<void>;
}

const OFFLINE_CONFIRM_MS = 750;
const PROBE_TIMEOUT_MS = 2500;
const PROBE_INTERVAL_MS = 8000;

export async function probeHealthz(signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE}/healthz`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`healthz returned HTTP ${response.status}`);
  }
}

export function useConnectivityStatus(): ConnectivitySnapshot {
  const [status, setStatus] = useState<ConnectivityStatus>("checking");
  const probeSeqRef = useRef(0);
  const offlineTimerRef = useRef<number | null>(null);

  const clearOfflineTimer = useCallback(() => {
    if (offlineTimerRef.current !== null) {
      window.clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }
  }, []);

  const probe = useCallback(async () => {
    const seq = ++probeSeqRef.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      await probeHealthz(controller.signal);
      if (probeSeqRef.current !== seq) return;
      clearOfflineTimer();
      setStatus("online");
    } catch {
      if (probeSeqRef.current !== seq) return;
      clearOfflineTimer();
      offlineTimerRef.current = window.setTimeout(() => {
        if (probeSeqRef.current === seq) {
          setStatus("offline");
        }
      }, OFFLINE_CONFIRM_MS);
    } finally {
      window.clearTimeout(timeout);
    }
  }, [clearOfflineTimer]);

  useEffect(() => {
    void probe();
    const handleHintChange = () => {
      void probe();
    };
    window.addEventListener("online", handleHintChange);
    window.addEventListener("offline", handleHintChange);
    const interval = window.setInterval(() => {
      void probe();
    }, PROBE_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", handleHintChange);
      window.removeEventListener("offline", handleHintChange);
      window.clearInterval(interval);
      clearOfflineTimer();
    };
  }, [clearOfflineTimer, probe]);

  return { status, online: status === "online", probe };
}

export function useOnlineStatus(): boolean {
  return useConnectivityStatus().online;
}
