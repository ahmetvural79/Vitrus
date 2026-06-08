import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { renderGraphSvg } from "../src/api/graph.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");

async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("graphSnapshot + renderGraphSvg: düğüm/kenar + bayat işareti (C3)", async () => {
  const e = await buildEngine();
  try {
    const snap = await e.graphSnapshot();
    assert.ok(snap.nodes.length > 0);
    assert.ok(snap.edges.length > 0);
    assert.ok(snap.nodes.some((n) => n.stale), "supersede edilmiş en az bir bayat düğüm");

    const svg = renderGraphSvg(snap);
    assert.match(svg, /^<svg/);
    assert.match(svg, /knowledge graph/);
    assert.match(svg, /<circle/); // düğüm noktaları
    assert.match(svg, /<line/); // kenarlar
    assert.match(svg, /stroke-dasharray/); // bayat/çelişki kesik çizgi
  } finally {
    await e.close();
  }
});

test("graphSnapshot: limit → truncated raporlanır (sessiz kırpma yok)", async () => {
  const e = await buildEngine();
  try {
    const snap = await e.graphSnapshot({ limit: 3 });
    assert.equal(snap.nodes.length, 3);
    assert.ok(snap.truncated > 0, "kırpılan düğüm sayısı raporlanmalı");
  } finally {
    await e.close();
  }
});
