// test/dream-analysis.test.ts — M3.8 rüya döngüsü derinleştirme (citation-fix + contradiction + briefing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCitations, contradictionDigest, buildBriefing, renderBriefing } from "../src/maintenance/dream-analysis.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { slugToId } from "../src/sync/wikilinks.js";
import type { KnowledgeNode, NodeType, TypedEdge } from "../src/core/types.js";

function mk(
  slug: string,
  type: NodeType,
  o: { title?: string; content?: string; uri?: string | null } = {}
): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type,
    tier: "durable",
    title: o.title ?? slug.split("/").pop() ?? slug,
    content: o.content ?? "content",
    frontmatter: {},
    salience: 1,
    provenance: { connector: o.uri ? "manual" : null, sourceId: null, uri: o.uri ?? null, capturedAt: null },
    acl: [],
    contentHash: slug,
  };
}

async function seed() {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  // Uncited incident (kaynak yok) + lexical-benzer KAYNAKLI incident → citation önerisi.
  // (uncited gap yalnız EVENT_TYPES = incident/meeting/source için tetiklenir.)
  await engine.putNode(mk("durable/incidents/x-ratelimit", "incident", { title: "rate limit incident", content: "we hit the rate limit" }));
  await engine.putNode(mk("durable/incidents/y-ratelimit", "incident", { title: "rate limit postmortem", content: "rate limit incident postmortem reference", uri: "https://src/y" }));
  // İki çelişen karar (contradicts kenarı) → açık çelişki.
  await engine.putNode(mk("durable/decisions/p", "decision", { title: "use redis", content: "cache is redis" }));
  const edge: TypedEdge = { fromId: slugToId("durable/decisions/p"), toId: slugToId("durable/decisions/q"), type: "contradicts", confidence: 1 };
  await engine.putNode(mk("durable/decisions/q", "decision", { title: "use memcached", content: "cache is memcached" }), [edge]);
  return engine;
}

test("dream-analysis: suggestCitations uncited düğüm için kaynaklı eşleşme önerir", async () => {
  const engine = await seed();
  const sugg = await suggestCitations(engine, { limit: 20 });
  const x = sugg.find((s) => s.slug === "durable/incidents/x-ratelimit");
  assert.ok(x, "uncited düğüm sonuçta olmalı");
  assert.ok(x!.suggestion, "lexical-benzer kaynaklı düğüm önerilmeli");
  assert.equal(x!.suggestion!.slug, "durable/incidents/y-ratelimit");
  assert.equal(x!.suggestion!.uri, "https://src/y");
});

test("dream-analysis: contradictionDigest açık çelişkiyi + daha-yeni ipucunu döner", async () => {
  const engine = await seed();
  const dig = await contradictionDigest(engine);
  assert.ok(dig.length >= 1, "en az 1 açık çelişki");
  const c = dig[0];
  assert.ok([c.a, c.b].includes("durable/decisions/p"));
  assert.ok([c.a, c.b].includes("durable/decisions/q"));
  assert.ok(c.newer === "durable/decisions/p" || c.newer === "durable/decisions/q", "daha-yeni taraf ipucu");
});

test("dream-analysis: buildBriefing boşluk + çelişki + düzeltilebilir-uncited sayar", async () => {
  const engine = await seed();
  const b = await buildBriefing(engine, "2026-06-21T00:00:00Z");
  assert.equal(b.generatedAt, "2026-06-21T00:00:00Z");
  assert.ok((b.gapCounts.uncited ?? 0) >= 1, "uncited boşluk sayılmalı");
  assert.ok(b.openConflicts >= 1, "açık çelişki sayılmalı");
  assert.ok(b.fixableUncited >= 1, "kaynak önerisi olan uncited sayılmalı");
  assert.ok(renderBriefing(b).includes("Briefing"), "render metni");
});
