import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("failed event bookkeeping does not double-count the claimed attempt", async () => {
  const source = await readFile(new URL("../app/api/internal/process-whatsapp/route.ts", import.meta.url), "utf8");
  const processingUpdate = source.split("\n").find((line) => line.includes("processing_status = 'processing'"));
  const failureUpdate = source.split("\n").find((line) => line.includes("processing_status = 'failed'") && line.includes("last_error"));
  assert.ok(processingUpdate);
  assert.ok(failureUpdate);
  assert.ok(processingUpdate.includes("attempts = attempts + 1"));
  assert.ok(!failureUpdate.includes("attempts = attempts + 1"));
});
