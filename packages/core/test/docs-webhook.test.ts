import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { ingest } from "../src/connectors/ingest.js";
import { DocsConnector } from "../src/connectors/docs.js";
import { ChangeQueue, applyChange, parseWebhook } from "../src/connectors/webhook.js";
import type { SourceRecord } from "../src/connectors/types.js";

const fix = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

test("DocsConnector (notion): per-item ACL + yazar kenarı + provenance", async () => {
  const e = await freshEngine();
  try {
    const r = await ingest(e, new DocsConnector("notion", join(fix, "notion-export.json")));
    assert.equal(r.upserted, 2);
    const runbook = await e.getNode("working/notion/runbook-oncall");
    assert.ok(runbook);
    assert.equal(runbook!.provenance.connector, "notion");
    // per-item acl: group:eng, group:oncall
    assert.ok(runbook!.acl.some((a) => a.principal === "eng") && runbook!.acl.some((a) => a.principal === "oncall"));
    const edges = await e.getConnections("working/notion/runbook-oncall");
    assert.ok(edges.some((x) => x.toId === "durable/people/bob"), "yazar kenarı");
  } finally {
    await e.close();
  }
});

test("DocsConnector: public item ACL ile herkese görünür", async () => {
  const e = await freshEngine();
  try {
    await ingest(e, new DocsConnector("notion", join(fix, "notion-export.json")));
    // rate-limit-rfc public → yetkisiz bile görür
    const hits = await e.search("rate-limit RFC gerekçe", { limit: 20, principals: ["__outsider__"] });
    assert.ok(hits.some((h) => h.node.slug === "working/notion/rate-limit-rfc"));
  } finally {
    await e.close();
  }
});

test("webhook: upsert düğüm ekler, delete soft-delete eder (canlı senkron)", async () => {
  const e = await freshEngine();
  try {
    const rec: SourceRecord = {
      sourceId: "X1",
      type: "note",
      title: "Canlı kayıt",
      content: "webhook ile geldi [[durable/x]]",
      uri: null,
      capturedAt: null,
      acl: [{ kind: "public", principal: "PUBLIC" }],
      slug: "working/linear/X1",
    };
    const q = new ChangeQueue();
    q.enqueue({ connector: "linear", action: "upsert", record: rec });
    const r = await q.drain(e);
    assert.deepEqual(r, { applied: 1, upserts: 1, deletes: 0 });
    assert.ok(await e.getNode("working/linear/X1"), "upsert sonrası var");

    await applyChange(e, { connector: "linear", action: "delete", slug: "working/linear/X1" });
    assert.equal(await e.getNode("working/linear/X1"), null, "delete sonrası yok");
  } finally {
    await e.close();
  }
});

test("parseWebhook: ham yük → ChangeEvent (upsert/delete)", () => {
  const up = parseWebhook("notion", "working/notion/", { action: "upsert", item: { id: "A", title: "T", body: "b" } });
  assert.equal(up.action, "upsert");
  assert.equal(up.record!.slug, "working/notion/A");
  const del = parseWebhook("notion", "working/notion/", { action: "delete", id: "A" });
  assert.equal(del.action, "delete");
  assert.equal(del.slug, "working/notion/A");
  assert.throws(() => parseWebhook("notion", "working/notion/", { action: "bogus" }));
});
