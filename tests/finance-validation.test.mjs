import test from "node:test";
import assert from "node:assert/strict";
import { isCalendarDate, toMinorUnits } from "../lib/finance-validation.ts";

test("accepts real calendar dates including leap day", () => {
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-10-13"), true);
});

test("rejects impossible, normalized, and malformed calendar dates", () => {
  for (const value of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", "2026-10-13T00:00:00Z", "", null, 20261013]) {
    assert.equal(isCalendarDate(value), false, String(value));
  }
});

test("converts valid monetary inputs to integer minor units without float comparisons", () => {
  assert.equal(toMinorUnits("0.01"), 1);
  assert.equal(toMinorUnits("1"), 100);
  assert.equal(toMinorUnits("125000.5"), 12500050);
  assert.equal(toMinorUnits(1000000000000), 100000000000000);
});

test("rejects invalid or ambiguous monetary inputs", () => {
  for (const value of ["", "  ", "-1", "-0.01", "1.001", "01", "1e3", "NaN", Infinity, NaN, null, {}, "100000000000000000000"]) {
    assert.equal(toMinorUnits(value), null, String(value));
  }
});

test("supports exact boundary checks with integer minor units", () => {
  const received = toMinorUnits("99.90");
  const incoming = toMinorUnits("0.10");
  const invoice = toMinorUnits("100.00");
  assert.notEqual(received, null);
  assert.notEqual(incoming, null);
  assert.notEqual(invoice, null);
  assert.equal(received + incoming, invoice);
  assert.equal(received + incoming + 1 > invoice, true);
});
