import test from "node:test";
import assert from "node:assert/strict";
import { calculateSubscriptionInvoice, isValidBillingPeriod } from "../lib/platform-billing.ts";

test("monthly subscription has no discount", () => {
  assert.deepEqual(calculateSubscriptionInvoice(475000, "monthly"), { subtotal: 475000, discount: 0, totalBeforeTax: 475000 });
});

test("yearly subscription bills twelve months and applies exactly ten percent", () => {
  assert.deepEqual(calculateSubscriptionInvoice(475000, "yearly"), { subtotal: 5700000, discount: 570000, totalBeforeTax: 5130000 });
  assert.deepEqual(calculateSubscriptionInvoice(895000, "yearly"), { subtotal: 10740000, discount: 1074000, totalBeforeTax: 9666000 });
  assert.deepEqual(calculateSubscriptionInvoice(1595000, "yearly"), { subtotal: 19140000, discount: 1914000, totalBeforeTax: 17226000 });
});

test("billing periods validate full months and twelve-month annual terms", () => {
  assert.equal(isValidBillingPeriod("2026-10-01", "2026-10-31", "monthly"), true);
  assert.equal(isValidBillingPeriod("2026-10-01", "2027-09-30", "yearly"), true);
  assert.equal(isValidBillingPeriod("2026-10-01", "2027-10-01", "yearly"), false);
  assert.equal(isValidBillingPeriod("2026-10-02", "2027-09-30", "yearly"), false);
  assert.equal(isValidBillingPeriod("2026-02-01", "2026-02-28", "monthly"), true);
  assert.equal(isValidBillingPeriod("2026-02-01", "2026-02-29", "monthly"), false);
});

test("subscription invoice calculation fails closed on invalid fees", () => {
  assert.equal(calculateSubscriptionInvoice(0, "yearly"), null);
  assert.equal(calculateSubscriptionInvoice(-1, "monthly"), null);
  assert.equal(calculateSubscriptionInvoice(Number.NaN, "yearly"), null);
});