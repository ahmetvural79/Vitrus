// test/schema.test.ts — M3.7 Schema packs v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VITRUS_BASE_PACK, validatePack, coverageGaps, explainType, loadPack, schemaLint } from "../src/schema/index.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { slugToId } from "../src/sync/wikilinks.js";
import type { KnowledgeNode, NodeType, TypedEdge } from "../src/core/types.js";

test("schema: base pack iyi-biçimli (validatePack boş)", () => {
  assert.deepEqual(validatePack(VITRUS_BASE_PACK), []);
});

test("schema: base pack donmuş NodeType/EdgeType union'ını TAM kapsar (drift yok)", () => {
  const g = coverageGaps(VITRUS_BASE_PACK);
  assert.deepEqual(g.missingNodeTypes, [], "eksik node tipi");
  assert.deepEqual(g.missingEdgeTypes, [], "eksik edge tipi");
  assert.deepEqual(g.extraNodeTypes, [], "fazla node tipi");
  assert.deepEqual(g.extraEdgeTypes, [], "fazla edge tipi");
});

test("schema: explainType(node) katıldığı kenarları listeler", () => {
  const p = explainType(VITRUS_BASE_PACK, "person");
  assert.ok(p && p.kind === "node");
  const fromTypes = (p.edgesAsFrom ?? []).map((e) => e.type);
  for (const t of ["works_at", "member_of", "reports_to"]) assert.ok(fromTypes.includes(t), `person kaynak: ${t}`);
});

test("schema: explainType(edge) from/to döner", () => {
  const e = explainType(VITRUS_BASE_PACK, "works_at");
  assert.ok(e && e.kind === "edge");
  assert.deepEqual(e.from, ["person"]);
  assert.deepEqual(e.to, ["company"]);
});

test("schema: explainType(bilinmeyen) → null", () => {
  assert.equal(explainType(VITRUS_BASE_PACK, "nope"), null);
});

test("schema: loadPack geçersizi reddeder, geçerliyi yükler", () => {
  assert.throws(() => loadPack({ name: "", version: "", nodeTypes: [], edgeTypes: [] }));
  const ok = loadPack({
    name: "x",
    version: "1",
    nodeTypes: [{ name: "person", description: "p" }],
    edgeTypes: [{ name: "knows", from: ["person"], to: ["person"], description: "d" }],
  });
  assert.equal(ok.name, "x");
});

test("schema: lint kenar from/to ihlalini deterministik yakalar", async () => {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  const mk = (slug: string, type: NodeType): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> => ({
    slug,
    type,
    tier: "durable",
    title: slug.split("/").pop() ?? slug,
    content: "x",
    frontmatter: {},
    salience: 1,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    contentHash: slug,
  });
  await engine.putNode(mk("durable/people/alice", "person"));
  // works_at base'de person→company; hedef SERVICE → edge_to_violation beklenir.
  const edge: TypedEdge = { fromId: slugToId("durable/people/alice"), toId: slugToId("durable/services/api"), type: "works_at", confidence: 1 };
  await engine.putNode(mk("durable/services/api", "service"), [edge]);

  const r = await schemaLint(engine, VITRUS_BASE_PACK);
  const viol = r.findings.find((f) => f.kind === "edge_to_violation" && f.edge?.type === "works_at");
  assert.ok(viol, "works_at→service to-ihlali bulunmalı");
  assert.equal(r.pack, "vitrus-base");
});
