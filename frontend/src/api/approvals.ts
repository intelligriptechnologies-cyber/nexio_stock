import { listPendingVoids } from "./voids";
import { listStockInwards } from "./lots";
import type { InvoicePublic } from "./checkout";
import type { LotPublic } from "./lots";

export interface PendingApprovalsData {
  voids: InvoicePublic[];
  inward: LotPublic[];
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
  const data = await listPendingApprovals(shopId);
  return data.voids.length + data.inward.length;
}
