// Wrappers for the existing void endpoints (see app/api/voids.py and
// app/api/dashboard.py). All three mutation endpoints are POST and are
// described in the backend's docstring:
//
//   POST /invoices/{id}/void            request a void
//                                        pre-EOD: voids directly
//                                        post-EOD: creates PENDING_VOID
//   POST /invoices/{id}/void/approve    owner only — creates REVERSAL
//   POST /invoices/{id}/void/reject     owner only — reverts to FINALIZED
//
// The pending-void queue list is at GET /dashboard/void-queue.

import { api } from "./client";
import type { InvoicePublic } from "./checkout";

export interface PendingVoidResponse {
  invoices: InvoicePublic[];
}

export function requestVoid(invoiceId: number, reason?: string): Promise<InvoicePublic> {
  return api<InvoicePublic>(`/invoices/${invoiceId}/void`, {
    method: "POST",
    json: reason ? { reason } : {},
  });
}

export function approveVoid(invoiceId: number): Promise<InvoicePublic> {
  return api<InvoicePublic>(`/invoices/${invoiceId}/void/approve`, { method: "POST" });
}

export function rejectVoid(invoiceId: number, reason?: string): Promise<InvoicePublic> {
  return api<InvoicePublic>(`/invoices/${invoiceId}/void/reject`, {
    method: "POST",
    json: reason ? { reason } : {},
  });
}

export function listPendingVoids(shopId?: number | null): Promise<PendingVoidResponse> {
  const qs = shopId != null ? `?shop_id=${shopId}` : "";
  return api<PendingVoidResponse>(`/dashboard/void-queue${qs}`);
}