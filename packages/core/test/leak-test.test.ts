import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { runLeakTest, explainSearch } from "../src/security/leak-test.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
const store = new MarkdownStore(brainDir);

async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of store.readAll()) await e.putNode(node, edges);
  return e;
}

test("sızıntı harness'ı: özel doc var, sızıntı YOK (sert kapı geçer)", async () => {
  const e = await buildEngine();
  try {
    const r = await runLeakTest(e, store);
    assert.ok(r.restrictedDocs > 0, "korpusta özel doc olmalı (test anlamlı)");
    assert.ok(r.checks > 0);
    assert.deepEqual(r.leaks, [], "hiç sızıntı olmamalı");
    assert.equal(r.ok, true);
  } finally {
    await e.close();
  }
});

test("explainSearch (test mode): yetkisiz için ACL'in eledikleri görünür", async () => {
  const e = await buildEngine();
  try {
    const x = await explainSearch(e, "gateway kesinti incident 503", ["__outsider__"]);
    // incident (özel) yetkisiz için elenenlerde olmalı, dönenlerde olmamalı
    assert.ok(x.excluded.includes("durable/incidents/2026-05-12-gateway-outage"));
    assert.ok(!x.returned.includes("durable/incidents/2026-05-12-gateway-outage"));
  } finally {
    await e.close();
  }
});

test("audit log: yetkili sorgu yazılır; getAudit 'doc X'i kim gördü' döndürür", async () => {
  const e = await buildEngine();
  try {
    await e.search("gateway kesinti incident", { limit: 10, principals: ["eng"], audit: true });
    const all = await e.getAudit();
    assert.equal(all.length, 1);
    assert.equal(all[0].principal, "eng");
    assert.ok(Array.isArray(all[0].returned) && Array.isArray(all[0].excluded));

    // incident'i eng gördü mü?
    const sawIncident = await e.getAudit({ doc: "durable/incidents/2026-05-12-gateway-outage" });
    assert.equal(sawIncident.length, 1);
    assert.equal(sawIncident[0].principal, "eng");

    // görülmeyen doc → kayıt yok
    assert.equal((await e.getAudit({ doc: "yok/bisey" })).length, 0);
  } finally {
    await e.close();
  }
});

test("audit yalnız audit:true + principals ile yazılır (kısıtsız sorgu yazmaz)", async () => {
  const e = await buildEngine();
  try {
    await e.search("platform", { limit: 5 }); // principals yok, audit yok
    await e.search("platform", { limit: 5, principals: ["eng"] }); // audit:true yok
    assert.equal((await e.getAudit()).length, 0);
  } finally {
    await e.close();
  }
});
