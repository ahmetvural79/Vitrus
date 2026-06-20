import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyGraphSignals } from "../src/search/graph-signals.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import type { SearchHit } from "../src/core/types.js";

function hit(id: string, connector: string, score = 0.01): SearchHit {
  return { node: { id, slug: id, provenance: { connector } }, score, boosts: {} } as unknown as SearchHit;
}

test("adjacency: havuz-içi başka sonuca bağlı düğüm boost alır, bağlantısız almaz", () => {
  const out = applyGraphSignals([hit("a", "github"), hit("b", "github"), hit("c", "github")], [
    { from: "a", to: "b" },
  ]);
  const a = out.find((h) => h.node.id === "a")!;
  const c = out.find((h) => h.node.id === "c")!;
  assert.ok(a.boosts!.adjacency! > 1, "a→b bağlı → adjacency boost");
  assert.ok(a.score > 0.01, "score arttı");
  assert.equal(c.boosts?.adjacency, undefined, "c bağlantısız → boost yok");
});

test("cross-source: FARKLI connector'a bağlı → corroboration; AYNI connector → yok", () => {
  const diff = applyGraphSignals([hit("a", "github"), hit("b", "slack")], [{ from: "a", to: "b" }]);
  const a1 = diff.find((h) => h.node.id === "a")!;
  assert.ok(a1.boosts!.adjacency! > 1);
  assert.ok(a1.boosts!.corroboration! > 1, "github↔slack → cross-source teyidi");

  const same = applyGraphSignals([hit("a", "github"), hit("b", "github")], [{ from: "a", to: "b" }]);
  const a2 = same.find((h) => h.node.id === "a")!;
  assert.ok(a2.boosts!.adjacency! > 1);
  assert.equal(a2.boosts?.corroboration, undefined, "aynı kaynak → corroboration yok");
});

test("ACL güvenliği: havuz-DIŞI düğüme giden kenar sayılmaz", () => {
  const out = applyGraphSignals([hit("a", "github"), hit("b", "github")], [{ from: "a", to: "ZZZ-restricted" }]);
  const a = out.find((h) => h.node.id === "a")!;
  assert.equal(a.boosts?.adjacency, undefined, "havuz-dışı (yetkisiz olabilecek) kenar boost vermez");
});

test("kenar yoksa / tek hit → değişmez (aynı referans)", () => {
  const hits = [hit("a", "x"), hit("b", "y")];
  assert.equal(applyGraphSignals(hits, []), hits);
  const one = [hit("a", "x")];
  assert.equal(applyGraphSignals(one, [{ from: "a", to: "b" }]), one);
});

// --- motor entegrasyonu: gerçek brain fixture üstünde ---
const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("engine: graf-sinyali boost uygular; graphSignals=false kapatır; KÜME değişmez (eval-güvenli)", async () => {
  const e = await buildEngine();
  try {
    const on = await e.search("incident gateway", { limit: 10 });
    const off = await e.search("incident gateway", { limit: 10, graphSignals: false });
    assert.ok(on.some((h) => h.boosts?.adjacency), "açıkken en az bir adjacency boost (brain bağlı graf)");
    assert.ok(off.every((h) => !h.boosts?.adjacency), "graphSignals=false → adjacency yok");
    // Havuz=limit olduğundan döndürülen küme aynı kalmalı (yalnız sıra değişebilir).
    assert.deepEqual(
      new Set(on.map((h) => h.node.slug)),
      new Set(off.map((h) => h.node.slug)),
      "graf-sinyali döndürülen KÜMEYİ değiştirmez (recall invariantı)"
    );
  } finally {
    await e.close();
  }
});
