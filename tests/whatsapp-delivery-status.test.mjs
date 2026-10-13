import test from "node:test";
import assert from "node:assert/strict";
import { mergeWhatsAppDeliveryStatus, shouldAcceptDeliveryTimestamp } from "../lib/whatsapp-delivery-status.ts";

test("delivery status only moves forward despite late callbacks", () => {
  assert.equal(mergeWhatsAppDeliveryStatus("read", "sent"), "read");
  assert.equal(mergeWhatsAppDeliveryStatus("delivered", "sent"), "delivered");
  assert.equal(mergeWhatsAppDeliveryStatus("sent", "delivered"), "delivered");
  assert.equal(mergeWhatsAppDeliveryStatus("delivered", "read"), "read");
  assert.equal(mergeWhatsAppDeliveryStatus("sent", "failed"), "sent");
  assert.equal(mergeWhatsAppDeliveryStatus("failed", "delivered"), "failed");
});

test("unknown initial status accepts a valid provider status", () => {
  assert.equal(mergeWhatsAppDeliveryStatus("received", "sent"), "sent");
  assert.equal(mergeWhatsAppDeliveryStatus(undefined, "delivered"), "delivered");
});

test("delivery metadata only advances for valid non-stale timestamps", () => {
  assert.equal(shouldAcceptDeliveryTimestamp("", "1791880000"), true);
  assert.equal(shouldAcceptDeliveryTimestamp("1791880000", "1791880001"), true);
  assert.equal(shouldAcceptDeliveryTimestamp("1791880001", "1791880000"), false);
  assert.equal(shouldAcceptDeliveryTimestamp("", "bad"), false);
  assert.equal(shouldAcceptDeliveryTimestamp("", "1"), false);
});
