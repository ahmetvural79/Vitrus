import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { dreamLoop } from "../src/maintenance/dream-loop.js";
import type { KnowledgeNode } from "../src/core/types.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function corpusEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
function n(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug, type: "note", tier: "working", title: slug, content,
    frontmatter: {}, salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], contentHash: "",
  };
}

test("dreamLoop: korpusta varlık+boşluk+bayat-sönüm (deterministik, denetlenebilir)", async () => {
  const e = await corpusEngine();
  try {
    const r = await dreamLoop(e);
    assert.ok(r.entities > 0, "varlık hesaplandı");
    assert.ok(r.gaps > 0, "boşluk raporu");
    assert.ok(r.staleDecayed >= 1, "0003 süpersede → bayat sönüm");
    assert.equal(r.merges.length, 0, "korpusta yinelenen yok");
  } finally {
    await e.close();
  }
});

test("dreamLoop: dedup ≥0.92 OTOMATİK birleştirir (survivor=lexikografik küçük)", async () => {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  try {
    const dup = "Rate limit eşiği 500 rps olarak ayarlandı ve gözden geçirildi sonra.";
    await e.putNode(n("working/dup/a", dup));
    await e.putNode(n("working/dup/b", dup)); // a ile birebir aynı → sim ~1.0
    await e.putNode(n("working/dup/ref", "bkz [[working/dup/a]] ve [[working/dup/b]]"));

    const r = await dreamLoop(e);
    assert.equal(r.merges.length, 1);
    assert.equal(r.merges[0].survivor, "working/dup/a");
    assert.equal(r.merges[0].duplicate, "working/dup/b");
    assert.equal(await e.getNode("working/dup/b"), null, "duplicate soft-delete");
    assert.ok(await e.getNode("working/dup/a"), "survivor durur");
    // referrer'ın kenarı survivor'a yönlendi (b artık yok)
    const refEdges = await e.getConnections("working/dup/ref");
    assert.ok(refEdges.some((x) => x.toId === "working/dup/a"));
    assert.ok(!refEdges.some((x) => x.toId === "working/dup/b"));
  } finally {
    await e.close();
  }
});

test("decayStale: bayat düğüm salience'ı düşer", async () => {
  const e = await corpusEngine();
  try {
    await e.refreshSalience();
    const before = (await e.getNode("durable/decisions/0003-rate-limit"))!.salience;
    const count = await e.decayStale(0.5);
    const after = (await e.getNode("durable/decisions/0003-rate-limit"))!.salience;
    assert.ok(count >= 1);
    assert.ok(after < before || before === 0, `bayat sönüm: ${before} → ${after}`);
  } finally {
    await e.close();
  }
});
