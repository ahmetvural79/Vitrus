import { test } from "node:test";
import assert from "node:assert/strict";
import { explainFactors, formatExplain } from "../src/search/explain.js";
import type { SearchHit } from "../src/core/types.js";

// Minimal SearchHit (node alanı testte gerekmiyor → cast).
function hit(partial: Partial<SearchHit>): SearchHit {
  return { node: { slug: "durable/x" }, score: 0.5, ...partial } as unknown as SearchHit;
}

test("explainFactors: ham sıraları + boost'ları + birleşik skoru döker", () => {
  const joined = explainFactors(
    hit({
      score: 0.1234,
      vectorRank: 2,
      bm25Rank: 1,
      entityRank: 3,
      boosts: { tier: 1.15, cosine: 0.8123, rerank: 0.92 },
    })
  ).join("\n");
  assert.match(joined, /vector\s+rank #2/);
  assert.match(joined, /bm25\s+rank #1/);
  assert.match(joined, /entity\s+rank #3/);
  assert.match(joined, /tier\s+×1\.15/); // çarpan boost → ×
  assert.match(joined, /cosine\s+= 0\.8123/); // ham skor boost → =
  assert.match(joined, /rerank\s+= 0\.92/);
  assert.match(joined, /→ score\s+0\.12340/); // birleşik skor en sonda
});

test("explainFactors: bilinmeyen boost anahtarı olduğu gibi yüzeyler (ileri-uyumlu)", () => {
  // M3.1 graph-signal ranking 'adjacency'/'corroboration' eklediğinde OTOMATİK görünmeli.
  const joined = explainFactors(
    hit({ boosts: { adjacency: 1.05, corroboration: 1.1, brandNew: 0.42 } })
  ).join("\n");
  assert.match(joined, /graph-adjacency\s+×1\.05/);
  assert.match(joined, /cross-source\s+×1\.1/);
  assert.match(joined, /brandNew\s+= 0\.42/); // bilinmeyen anahtar ham yazılır
});

test("explainFactors: eksik sinyaller atlanır (yalnız mevcut faktörler)", () => {
  const joined = explainFactors(hit({ score: 0.5, vectorRank: 1 })).join("\n");
  assert.match(joined, /vector\s+rank #1/);
  assert.ok(!/bm25/.test(joined), "bm25 yoksa satır olmamalı");
  assert.match(joined, /→ score\s+0\.50000/);
});

test("formatExplain: girintili çok-satır bloğu üretir", () => {
  const block = formatExplain(hit({ vectorRank: 1, boosts: { tier: 1.0 } }), "  ");
  assert.ok(
    block.split("\n").every((l) => l.startsWith("  ")),
    "tüm satırlar girintili olmalı"
  );
});
