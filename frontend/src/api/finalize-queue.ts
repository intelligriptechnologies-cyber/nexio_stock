// localStorage-backed write queue for /checkout/finalize (D-29, R-14).
//
// When the cashier hits FINISH & PAY and the network is down, we don't
// drop the sale — we persist the request body + idempotency key in
// localStorage. When connectivity returns we retry automatically; the
// idempotency key prevents double-sell if the original request actually
// made it through but the response was lost.
//
// Invariant failures on retry (insufficient_stock, eod_signed_off, etc.)
// are surfaced to the caller, never silently dropped.

import { ApiError, api } from "./client";

export interface QueuedFinalize {
  idempotencyKey: string;
  body: {
    lines: { barcode: string; quantity: number }[];
    payments: { mode: string; amount: string }[];
    note?: string;
    shop_id?: number;
  };
  enqueuedAt: number;
  lastError: string | null;
  attempts: number;
}

const KEY = "barstock.finalize-queue.v1";

function readQueue(): QueuedFinalize[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedFinalize[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedFinalize[]): void {
  if (items.length === 0) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, JSON.stringify(items));
  }
}

export function enqueueFinalize(
  item: Omit<QueuedFinalize, "enqueuedAt" | "attempts" | "lastError">
): void {
  const q = readQueue();
  const existing = q.findIndex((x) => x.idempotencyKey === item.idempotencyKey);
  const next: QueuedFinalize = {
    ...item,
    enqueuedAt: Date.now(),
    lastError: null,
    attempts: 0,
  };
  if (existing >= 0) q[existing] = next;
  else q.push(next);
  writeQueue(q);
}

export function listQueued(): QueuedFinalize[] {
  return readQueue();
}

export function clearQueued(key: string): void {
  writeQueue(readQueue().filter((q) => q.idempotencyKey !== key));
}

export interface FlushOutcome {
  key: string;
  ok: boolean;
  status: number;
  detail: string;
  attempts: number;
}

// Flushes every queued finalize. Returns one outcome per queue entry.
// Server invariant failures (4xx other than 408/429) keep the entry on
// disk with lastError set; network errors (status 0/408/429) leave the
// entry for the next reconnect.
export async function flushQueue(): Promise<FlushOutcome[]> {
  const items = readQueue();
  const outcomes: FlushOutcome[] = [];
  for (const it of items) {
    try {
      await api<unknown>("/checkout/finalize", {
        method: "POST",
        json: it.body,
        idempotencyKey: it.idempotencyKey,
      });
      // Success — remove from queue.
      writeQueue(readQueue().filter((q) => q.idempotencyKey !== it.idempotencyKey));
      outcomes.push({ key: it.idempotencyKey, ok: true, status: 200, detail: "", attempts: it.attempts + 1 });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      const detail = e instanceof Error ? e.message : String(e);
      // Persist the new attempt count + last error.
      writeQueue(
        readQueue().map((q) =>
          q.idempotencyKey === it.idempotencyKey
            ? { ...q, attempts: q.attempts + 1, lastError: detail }
            : q
        )
      );
      outcomes.push({
        key: it.idempotencyKey,
        ok: false,
        status,
        detail,
        attempts: it.attempts + 1,
      });
      // For network errors / 408 / 429, leave the entry for the next
      // reconnect. For 4xx invariant failures (insufficient_stock,
      // eod_signed_off, etc.), keep it too but the caller MUST surface
      // the failure so the cashier can resolve manually.
    }
  }
  return outcomes;
}