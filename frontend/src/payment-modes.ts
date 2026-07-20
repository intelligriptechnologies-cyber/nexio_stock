import type { PaymentMode } from "./api/checkout";

export const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card", "other"];

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  other: "Other",
};

export function formatPaymentLabel(mode: PaymentMode): string {
  return PAYMENT_MODE_LABELS[mode];
}

export function hasOtherPaymentMode(payments: Array<{ mode: PaymentMode }>): boolean {
  return payments.some((payment) => payment.mode === "other");
}

export function requiresPaymentNote(payments: Array<{ mode: PaymentMode }>, note: string): boolean {
  return hasOtherPaymentMode(payments) && !note.trim();
}
