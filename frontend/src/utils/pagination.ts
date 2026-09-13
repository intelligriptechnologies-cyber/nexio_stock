export const STANDARD_PAGE_SIZES = [25, 50, 100] as const;
export const DASHBOARD_PAGE_SIZES = [10, 25, 50] as const;

export function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function pageSizeParam(
  value: string | null, allowed: readonly number[], fallback: number
): number {
  const parsed = positiveInt(value, fallback);
  return allowed.includes(parsed) ? parsed : fallback;
}

export function pageOffset(page: number, pageSize: number): number {
  return Math.max(0, page - 1) * pageSize;
}

export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
}
