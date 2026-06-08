// Proaktif attention (v1) — saf fonksiyon, deterministik. `now` ve düğüm zaman damgaları sabit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAttention, type AttentionNodeView } from "../src/attention/attention.js";
import type { Gap, TypedEdge, NodeType } from "../src/core/types.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

const NOW = "2026-06-08T00:00:00.000Z";
const DAY = 86_400_000;
function daysAgo(n: number): string {
  return new Date(Date.parse(NOW) - n * DAY).toISOString();
}
function node(id: string, type: NodeType, over: Partial<AttentionNodeView> = {}): AttentionNodeView {
  return { id, slug: `durable/${type}/${id}`, type, tier: "durable", title: id, updatedAt: NOW, capturedAt: null, ...over };
}

test("stale_knowledge: kalıcı karar/politika bayatlar; kişi/taze hariç", () => {
  const nodes = [
    node("d-old", "decision", { updatedAt: daysAgo(200) }), // high (>180)
    node("p-old", "policy", { updatedAt: daysAgo(100) }), // medium
    node("alice", "person", { updatedAt: daysAgo(300) }), // hariç (rot etmez)
    node("p-fresh", "policy", { updatedAt: daysAgo(10) }), // taze
  ];
  const items = computeAttention(nodes, [], [], NOW);
  const slugs = items.map((i) => i.slug);
  assert.ok(slugs.includes("durable/decision/d-old"));
  assert.ok(slugs.includes("durable/policy/p-old"));
  assert.equal(slugs.includes("durable/person/alice"), false);
  assert.equal(slugs.includes("durable/policy/p-fresh"), false);
  assert.equal(items.find((i) => i.slug === "durable/decision/d-old")!.severity, "high");
  assert.equal(items.find((i) => i.slug === "durable/policy/p-old")!.severity, "medium");
});

test("unresolved_incident: resolved_by kenarı yoksa ve eskiyse işaretlenir", () => {
  const nodes = [
    node("inc1", "incident", { capturedAt: daysAgo(10) }), // açık (>7)
    node("inc2", "incident", { capturedAt: daysAgo(10) }), // çözülmüş
    node("inc3", "incident", { capturedAt: daysAgo(2) }), // yeni (<7)
  ];
  const edges: TypedEdge[] = [{ fromId: "inc2", toId: "fix", type: "resolved_by", confidence: 1 }];
  const items = computeAttention(nodes, edges, [], NOW).filter((i) => i.kind === "unresolved_incident");
  const slugs = items.map((i) => i.slug);
  assert.deepEqual(slugs, ["durable/incident/inc1"]);
});

test("aging_gap: yapısal boşluk + ilgili düğüm yaşlıysa öğeye dönüşür", () => {
  const nodes = [node("n1", "document", { updatedAt: daysAgo(30) }), node("n2", "document", { updatedAt: daysAgo(5) })];
  const gaps: Gap[] = [
    { kind: "missing", message: "X belgelenmemiş", relatedNodeIds: ["n1"] },
    { kind: "missing", message: "Y belgelenmemiş", relatedNodeIds: ["n2"] }, // taze → atlanır
  ];
  const items = computeAttention(nodes, [], gaps, NOW).filter((i) => i.kind === "aging_gap");
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, "durable/document/n1");
  assert.match(items[0].message, /open for 30 days/);
});

test("sıralama: high önce, sonra yaş azalan; limit uygulanır", () => {
  const nodes = [
    node("a", "decision", { updatedAt: daysAgo(100) }), // medium
    node("b", "decision", { updatedAt: daysAgo(400) }), // high (>180), en yaşlı
    node("c", "decision", { updatedAt: daysAgo(200) }), // high
  ];
  const items = computeAttention(nodes, [], [], NOW, { limit: 2 });
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, "durable/decision/b"); // high + en yaşlı
  assert.equal(items[1].slug, "durable/decision/c"); // high
});

test("boş korpus → boş liste", () => {
  assert.deepEqual(computeAttention([], [], [], NOW), []);
});

test("engine.attention: gerçek motor (SQL gather) — eski incident → unresolved_incident", async () => {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  await engine.putNode({
    slug: "durable/incidents/old-outage",
    type: "incident",
    tier: "durable",
    title: "Eski gateway kesintisi",
    content: "gateway 503 — çözülmedi",
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: "manual", sourceId: "x", uri: null, capturedAt: daysAgo(20) },
    acl: [],
    contentHash: "h-old",
  });
  const items = await engine.attention(NOW);
  assert.ok(
    items.some((i) => i.kind === "unresolved_incident" && i.slug === "durable/incidents/old-outage"),
    "20 günlük çözülmemiş incident attention'da olmalı"
  );
  await engine.close();
});
