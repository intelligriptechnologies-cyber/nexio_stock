import { listPendingVoids } from "./voids";
import { listStockInwards } from "./lots";
import type { InvoicePublic } from "./checkout";
import type { LotPublic } from "./lots";
import { listPendingVoidsPage } from "./voids";
import { listStockInwardsPage } from "./lots";

export interface PendingApprovalsData {
  voids: InvoicePublic[];
  inward: LotPublic[];
}

export async function listPendingApprovalsPage(
  shopId: number | null | undefined, limit: number, offset: number, signal?: AbortSignal
) {
  const [voids, inward] = await Promise.all([
    listPendingVoidsPage(shopId, limit, offset, signal),
    listStockInwardsPage(shopId, limit, offset, "pending", signal),
  ]);
  return {
    voids: voids.data.invoices, inward: inward.data.lots,
    voidTotal: voids.total, inwardTotal: inward.total,
  };
}

export async function listPendingApprovals(shopId?: number | null): Promise<PendingApprovalsData> {
  const [voids, inward] = await Promise.all([
    listPendingVoids(shopId),
    listStockInwards(shopId, 200, "pending"),
  ]);
  return {
    voids: voids.invoices,
    inward: inward.lots,
  };
}

export async function getPendingApprovalsCount(shopId?: number | null): Promise<number> {
  const data = await listPendingApprovalsPage(shopId, 1, 0);
  return data.voidTotal + data.inwardTotal;
}
