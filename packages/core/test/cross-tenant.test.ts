import { test } from "node:test";
import assert from "node:assert/strict";
import { runCrossTenantTest } from "../src/security/cross-tenant-test.js";

test("çok-kiracılık: org A ↔ B çapraz-kiracı sızıntı = 0 (her okuma yolu)", async () => {
  const r = await runCrossTenantTest();
  assert.equal(r.leaks, 0, "sızıntı: " + r.details.join(" · "));
  assert.ok(r.checks >= 10, "yetersiz kontrol sayısı: " + r.checks);
});
