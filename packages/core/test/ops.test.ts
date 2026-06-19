import { test } from "node:test";
import assert from "node:assert/strict";
import { operationalFindings, renderOps, type OpsNodeView } from "../src/ops/ops.js";
import type { TypedEdge, KnowledgeNode, NodeType, Tier } from "../src/core/types.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { contentHash } from "../src/sync/markdown.js";
import { callTool } from "../src/mcp/tools.js";

function nv(id: string, type: NodeType): OpsNodeView {
  return { id, slug: id, type };
}
function ed(fromId: string, toId: string, type: TypedEdge["type"]): TypedEdge {
  return { fromId, toId, type, confidence: 1 };
}

// --- saf dedektörler (DB gerektirmez) ---

test("ops unowned: sahibi olmayan servis (high)", () => {
  const f = operationalFindings([nv("svc/api", "service")], []);
  assert.ok(f.some((x) => x.kind === "unowned" && x.severity === "high" && x.relatedNodeIds.includes("svc/api")));
});

test("ops bus_factor: tek KİŞİye bağlı servis (medium); iki sahip → yok", () => {
  const nodes = [nv("svc/pay", "service"), nv("p/alice", "person"), nv("p/bob", "person")];
  const one = operationalFindings(nodes, [ed("p/alice", "svc/pay", "owns")]);
  assert.ok(one.some((x) => x.kind === "bus_factor" && x.relatedNodeIds.includes("p/alice")));
  const two = operationalFindings(nodes, [ed("p/alice", "svc/pay", "owns"), ed("p/bob", "svc/pay", "owns")]);
  assert.equal(two.some((x) => x.kind === "bus_factor"), false);
});

test("ops: ekip sahibi → bus_factor DEĞİL ve unowned DEĞİL", () => {
  const f = operationalFindings([nv("svc/pay", "service"), nv("t/payments", "team")], [ed("t/payments", "svc/pay", "owns")]);
  assert.equal(f.some((x) => x.kind === "bus_factor"), false);
  assert.equal(f.some((x) => x.kind === "unowned"), false);
});

test("ops bottleneck: yüksek in-degree kişi (eşik 4); eşik altı → yok", () => {
  const nodes = ["p/bob", "p/a", "p/c", "p/d", "p/e"].map((x) => nv(x, "person"));
  const edges = ["p/a", "p/c", "p/d", "p/e"].map((x) => ed(x, "p/bob", "reports_to"));
  assert.ok(operationalFindings(nodes, edges).some((x) => x.kind === "bottleneck" && x.relatedNodeIds.includes("p/bob")));
  assert.equal(operationalFindings(nodes, edges.slice(0, 3)).some((x) => x.kind === "bottleneck"), false);
});

test("ops broken_handoff: bayat (süpersede) şeye depends_on (high)", () => {
  const nodes = [nv("svc/x", "service"), nv("svc/old", "service"), nv("svc/new", "service")];
  const edges = [ed("svc/new", "svc/old", "supersedes"), ed("svc/x", "svc/old", "depends_on")];
  assert.ok(operationalFindings(nodes, edges).some((x) => x.kind === "broken_handoff" && x.relatedNodeIds.includes("svc/old")));
});

test("ops redundant_tool: benzer İKİ SERVİS (similarPairs) → konsolidasyon (medium); non-service çift → yok", () => {
  const nodes = [nv("svc/datadog", "service"), nv("svc/newrelic", "service")];
  const f = operationalFindings(nodes, [], { similarPairs: [{ a: "svc/datadog", b: "svc/newrelic", sim: 0.95 }] });
  assert.ok(
    f.some((x) => x.kind === "redundant_tool" && x.severity === "medium" && x.relatedNodeIds.includes("svc/datadog") && x.relatedNodeIds.includes("svc/newrelic"))
  );
  const f2 = operationalFindings([nv("svc/a", "service"), nv("note/b", "note")], [], { similarPairs: [{ a: "svc/a", b: "note/b", sim: 0.99 }] });
  assert.equal(f2.some((x) => x.kind === "redundant_tool"), false, "biri servis değilse fire etmez");
});

test("ops: temiz sistem → bulgu yok + render", () => {
  const f = operationalFindings([nv("svc/api", "service"), nv("t/eng", "team")], [ed("t/eng", "svc/api", "owns")]);
  assert.equal(f.length, 0);
  assert.match(renderOps(f), /no operational/);
});

test("ops: şiddete göre sıralı (high önce medium)", () => {
  // svc/api unowned(high) + svc/pay bus_factor(medium)
  const nodes = [nv("svc/api", "service"), nv("svc/pay", "service"), nv("p/alice", "person")];
  const f = operationalFindings(nodes, [ed("p/alice", "svc/pay", "owns")]);
  assert.equal(f[0].severity, "high");
});

// --- engine entegrasyonu (PgliteEngine.findOps) ---

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}
async function put(e: PgliteEngine, slug: string, type: NodeType, content: string): Promise<void> {
  const node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
    slug,
    type,
    tier: slug.split("/")[0] as Tier,
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    contentHash: contentHash(content),
  };
  await e.putNode(node);
}

test("findOps (engine): sahipsiz servis unowned + tek-kişi bus_factor (wikilink→owns)", async () => {
  const e = await freshEngine();
  try {
    await put(e, "durable/services/orphan", "service", "orphan service, no owner");
    await put(e, "durable/people/alice", "person", "Alice [[owns::durable/services/pay]] the payments service.");
    await put(e, "durable/services/pay", "service", "payments service");
    const ops = await e.findOps();
    assert.ok(ops.some((f) => f.kind === "unowned" && f.message.includes("durable/services/orphan")), "orphan → unowned");
    assert.ok(ops.some((f) => f.kind === "bus_factor" && f.message.includes("durable/services/pay")), "pay → bus_factor");
  } finally {
    await e.close();
  }
});

test("findOps (engine): aynı içerikli iki servis → redundant_tool (dedupReview/pgvector)", async () => {
  const e = await freshEngine();
  try {
    const body = "Observability platform for metrics, traces and logs across all services.";
    await put(e, "durable/services/tool-a", "service", body);
    await put(e, "durable/services/tool-b", "service", body);
    const ops = await e.findOps({ redundantThreshold: 0.9 });
    assert.ok(ops.some((f) => f.kind === "redundant_tool"), "embedding-benzer iki servis redundant_tool olmalı");
  } finally {
    await e.close();
  }
});

test("ops_report MCP tool: yapısal findings döndürür", async () => {
  const e = await freshEngine();
  try {
    await put(e, "durable/services/orphan", "service", "no owner here");
    const r = await callTool(e, "ops_report", {});
    const out = r.structuredContent as { findings: { kind: string }[] };
    assert.ok(out.findings.some((f) => f.kind === "unowned"));
  } finally {
    await e.close();
  }
});
