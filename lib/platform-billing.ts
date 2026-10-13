export type BillingCycle = "monthly" | "yearly";

export function isCalendarDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidBillingPeriod(start: string | undefined, end: string | undefined, cycle: BillingCycle): boolean {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return false;
  const s = new Date(start + "T00:00:00.000Z");
  const e = new Date(end + "T00:00:00.000Z");
  if (s.getUTCDate() !== 1) return false;
  if (cycle === "monthly") {
    const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth() && end === last;
  }
  const last = new Date(Date.UTC(s.getUTCFullYear() + 1, s.getUTCMonth(), 0)).toISOString().slice(0, 10);
  return end === last;
}

export function calculateSubscriptionInvoice(monthlyFee: number, cycle: BillingCycle): { subtotal: number; discount: number; totalBeforeTax: number } | null {
  if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) return null;
  const subtotal = Math.round(monthlyFee * (cycle === "yearly" ? 12 : 1) * 100) / 100;
  const discount = cycle === "yearly" ? Math.round(subtotal * 0.1 * 100) / 100 : 0;
  if (!Number.isFinite(subtotal) || !Number.isFinite(discount) || discount > subtotal) return null;
  return { subtotal, discount, totalBeforeTax: Math.round((subtotal - discount) * 100) / 100 };
}