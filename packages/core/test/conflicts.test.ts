import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConflicts, renderConflicts } from "../src/conflicts/conflicts.js";
import type { Gap, TypedEdge, KnowledgeNode, NodeType, Tier } from "../src/core/types.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { contentHash } from "../src/sync/markdown.js";
import { callTool } from "../src/mcp/tools.js";

function gap(ids: string[], message: string): Gap {
  return { kind: "contradiction", message, relatedNodeIds: ids };
}
function sup(from: string, to: string): TypedEdge {
  return { fromId: from, toId: to, type: "supersedes", confidence: 1 };
}

// --- saf buildConflicts ---

test("buildConflicts: explicit çelişki iki tarafıyla, çözülmemiş", () => {
  const map = new Map([["a", { slug: "d/a", title: "A" }], ["b", { slug: "d/b", title: "B" }]]);
  const c = buildConflicts([gap(["a", "b"], '"a" contradicts "b" — needs clarification.')], [], map);
  assert.equal(c.length, 1);
  assert.equal(c[0].resolved, false);
  assert.equal(c[0].a.slug, "d/a");
  assert.equal(c[0].b.slug, "d/b");
  assert.equal(c[0].kind, "explicit");
});

test("buildConflicts: taraflar arasında supersedes → resolved=true", () => {
  const map = new Map([["a", { slug: "d/a", title: "A" }], ["b", { slug: "d/b", title: "B" }]]);
  assert.equal(buildConflicts([gap(["a", "b"], "contradicts")], [sup("a", "b")], map)[0].resolved, true);
  assert.equal(buildConflicts([gap(["a", "b"], "contradicts")], [sup("b", "a")], map)[0].resolved, true); // yön bağımsız
});

test("buildConflicts: single_valued → kaynak her hedefle eşlenir", () => {
  const map = new Map([["x", { slug: "p/x", title: "X" }], ["c1", { slug: "co/1", title: "C1" }], ["c2", { slug: "co/2", title: "C2" }]]);
  const c = buildConflicts([gap(["x", "c1", "c2"], '"x" points to multiple current targets via single-valued "works_at": c1, c2.')], [], map);
  assert.equal(c.length, 2);
  assert.ok(c.every((k) => k.kind === "single_valued"));
});

test("buildConflicts: açık çelişkiler resolved'lardan ÖNCE; render", () => {
  const map = new Map([["a", { slug: "a", title: "A" }], ["b", { slug: "b", title: "B" }], ["c", { slug: "c", title: "C" }], ["d", { slug: "d", title: "D" }]]);
  const c = buildConflicts([gap(["a", "b"], "x"), gap(["c", "d"], "y")], [sup("a", "b")], map); // a-b resolved, c-d open
  assert.equal(c[0].resolved, false, "açık olan önce");
  assert.match(renderConflicts([]), /sources agree/);
});

// --- engine + resolve uçtan uca ---

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}
async function put(e: PgliteEngine, slug: string, type: NodeType, content: string): Promise<void> {
  await e.putNode({
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
  } as Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">);
}

test("findConflicts + resolve_conflict (engine): açık çelişki → çöz → resolved + kaybeden STALE", async () => {
  const e = await freshEngine();
  try {
    await put(e, "durable/decisions/a", "decision", "Use one region. This [[contradicts::durable/decisions/b]].");
    await put(e, "durable/decisions/b", "decision", "Use two regions.");

    let conf = await e.findConflicts();
    assert.ok(conf.length >= 1, "çelişki görünmeli");
    assert.equal(conf.every((c) => !c.resolved), true, "başta hepsi açık");

    // çöz: A kazanır, B supersede edilir
    const r = await callTool(e, "resolve_conflict", { keep: "durable/decisions/a", supersede: "durable/decisions/b" }, {});
    assert.equal((r.structuredContent as { resolved: boolean }).resolved, true);

    conf = await e.findConflicts();
    assert.ok(conf.some((c) => c.resolved), "çözüm sonrası resolved görünmeli");

    const gaps = await e.findGaps();
    assert.ok(
      gaps.some((g) => g.kind === "stale" && g.relatedNodeIds.some((id) => id.includes("durable/decisions/b"))),
      "kaybeden B artık stale"
    );
  } finally {
    await e.close();
  }
});

test("resolve_conflict: erişilemeyen keep → resolved:false (fail-closed)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(e, "resolve_conflict", { keep: "durable/yok/x", supersede: "durable/yok/y" }, { principals: ["bob"] });
    assert.equal((r.structuredContent as { resolved: boolean }).resolved, false);
  } finally {
    await e.close();
  }
});
