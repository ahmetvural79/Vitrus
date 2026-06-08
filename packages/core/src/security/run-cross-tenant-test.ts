#!/usr/bin/env bun
// src/security/run-cross-tenant-test.ts — 5. CI kapısı (çok-kiracılık).
// Çapraz-kiracı erişim = 0 olmalı. Kurumsal satışta en güçlü kanıt.

import { runCrossTenantTest } from "./cross-tenant-test.js";

const r = await runCrossTenantTest();
console.log(`Cross-tenant leak test · ${r.checks} checks (org A ↔ B)`);
if (r.leaks === 0) {
  console.log("\n✓ NO CROSS-TENANT LEAKS — gate passed (çapraz-kiracı erişim = 0)");
} else {
  console.error(`\n✗ ${r.leaks} CROSS-TENANT LEAK(S):`);
  for (const d of r.details) console.error("  " + d);
  process.exit(1);
}
