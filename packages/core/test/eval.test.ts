import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { runEval } from "../src/eval/eval.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");

async function buildEngine(): Promise<PgliteEngine> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await engine.putNode(node, edges);
  return engine;
}

test("eval kapıları geçer: kaynak isabeti ≥%90, boşluk recall/precision %100", async () => {
  const engine = await buildEngine();
  try {
    const r = await runEval(engine);
    assert.ok(r.retrieval.rate >= 0.9, `kaynak isabeti ${r.retrieval.rate}`);
    assert.equal(r.gaps.recall, 1, "tüm bilinen boşluklar tespit edilmeli");
    assert.equal(r.gaps.precision, 1, "uydurma boşluk olmamalı");
    assert.equal(r.gaps.spurious, 0);
    assert.equal(r.ok, true);
  } finally {
    await engine.close();
  }
});

test("DETERMİNİST: ayrı indekslerde eval birebir aynı (tekrarlanabilir kanıt)", async () => {
  const a = await buildEngine();
  const b = await buildEngine();
  try {
    const ra = await runEval(a);
    const rb = await runEval(b);
    assert.equal(JSON.stringify(ra), JSON.stringify(rb));
  } finally {
    await a.close();
    await b.close();
  }
});
