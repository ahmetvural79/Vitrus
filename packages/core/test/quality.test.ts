import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import type { KnowledgeNode } from "../src/core/types.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
function node(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug, type: "note", tier: "working", title: slug, content,
    frontmatter: {}, salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], contentHash: "",
  };
}

test("entity-match: başlık sorguyla eşleşince entityRank set olur (3. sinyal)", async () => {
  const e = await buildEngine();
  try {
    const hits = await e.search("Alice Chen", { limit: 10 });
    const alice = hits.find((h) => h.node.slug === "durable/people/alice");
    assert.ok(alice, "alice dönmeli");
    assert.ok(typeof alice!.entityRank === "number", "başlık eşleşmesi → entityRank");
  } finally {
    await e.close();
  }
});

test("dedup kapısı: yakın-yinelenen çiftler tespit edilir (LLM'siz)", async () => {
  const e = await buildEngine();
  try {
    await e.putNode(node("working/dup/a", "Rate limit eşiği 500 rps olarak ayarlandı ve gözden geçirildi."));
    await e.putNode(node("working/dup/b", "Rate limit eşiği 500 rps olarak ayarlandı ve gözden geçirildi."));
    const pairs = await e.dedupReview(0.92);
    assert.ok(
      pairs.some((p) => [p.a, p.b].sort().join("|") === "working/dup/a|working/dup/b"),
      "aynı içerikli çift yakalanmalı"
    );
    assert.ok(pairs.every((p) => p.sim >= 0.92));
  } finally {
    await e.close();
  }
});

test("salience: çok-referanslı düğüm > az-referanslı (frekans×tazelik)", async () => {
  const e = await buildEngine();
  try {
    await e.refreshSalience();
    const alice = await e.getNode("durable/people/alice"); // çok backlink
    const runbook = await e.getNode("derived/runbooks/incident-resolution"); // backlink yok
    assert.ok(alice && runbook);
    assert.ok(alice!.salience > runbook!.salience, `alice ${alice!.salience} > runbook ${runbook!.salience}`);
    assert.ok(alice!.salience <= 1 && runbook!.salience >= 0);
  } finally {
    await e.close();
  }
});
