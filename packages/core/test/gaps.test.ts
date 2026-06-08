import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralGaps, coverageGap, gapsForNodes, type GapNodeView } from "../src/gap/gaps.js";
import type { TypedEdge } from "../src/core/types.js";

function node(p: Partial<GapNodeView> & { id: string }): GapNodeView {
  return {
    slug: p.id,
    type: "note",
    content: "",
    frontmatter: {},
    connector: null,
    sourceId: null,
    uri: null,
    ...p,
  };
}

test("structuralGaps: beş boşluk türünü de tespit eder", () => {
  const nodes: GapNodeView[] = [
    node({ id: "a", content: "bkz [[durable/x/b]]" }),
    node({ id: "durable/x/b", content: "", frontmatter: { stub: true } }), // missing
    node({ id: "pol", type: "policy", content: "Escalation yalnızca [[durable/people/alice]]'in bilgisinde — tek nokta riski." }), // single_point
    node({ id: "inc", type: "incident", content: "kaynaksız olay" }), // uncited
  ];
  const edges: TypedEdge[] = [
    { fromId: "a", toId: "durable/x/b", type: "mentions", confidence: 0.7 }, // b referans alır → missing
    { fromId: "m", toId: "n", type: "contradicts", confidence: 1 }, // contradiction
    { fromId: "d7", toId: "d3", type: "supersedes", confidence: 1 }, // stale: d3
  ];
  const gaps = structuralGaps(nodes, edges);
  const kinds = gaps.map((g) => g.kind).sort();
  assert.ok(kinds.includes("missing"));
  assert.ok(kinds.includes("contradiction"));
  assert.ok(kinds.includes("stale"));
  assert.ok(kinds.includes("single_point"));
  assert.ok(kinds.includes("uncited"));

  const missing = gaps.find((g) => g.kind === "missing")!;
  assert.ok(missing.relatedNodeIds.includes("a")); // referans veren
  const sp = gaps.find((g) => g.kind === "single_point")!;
  assert.ok(sp.relatedNodeIds.includes("durable/people/alice")); // ilgili kişi
});

test("structuralGaps: referans verilmeyen stub missing SAYILMAZ (gürültü değil)", () => {
  const gaps = structuralGaps([node({ id: "x", frontmatter: { stub: true } })], []);
  assert.equal(gaps.filter((g) => g.kind === "missing").length, 0);
});

test("structuralGaps: kaynağı olan olay uncited DEĞİL", () => {
  const gaps = structuralGaps(
    [node({ id: "i", type: "incident", content: "x", connector: "slack", sourceId: "C1" })],
    []
  );
  assert.equal(gaps.filter((g) => g.kind === "uncited").length, 0);
});

test("structuralGaps: tek-değerli yüklem çoklu hedef → contradiction (LLM'siz)", () => {
  const gaps = structuralGaps(
    [node({ id: "p", type: "person", content: "x" })],
    [
      { fromId: "p", toId: "co/a", type: "works_at", confidence: 1 },
      { fromId: "p", toId: "co/b", type: "works_at", confidence: 1 },
    ]
  );
  const c = gaps.find((g) => g.kind === "contradiction");
  assert.ok(c && c.message.includes("single-valued"), "single-valued works_at conflict");
  assert.ok(c!.relatedNodeIds.includes("co/a") && c!.relatedNodeIds.includes("co/b"));
});

test("coverageGap: zayıf eşleşme → boşluk; güçlü → null; eşleşme yok → boşluk", () => {
  assert.ok(coverageGap("q", 0.05) !== null);
  assert.equal(coverageGap("q", 0.5), null);
  assert.ok(coverageGap("q", null) !== null);
});

test("gapsForNodes: yalnız ilgili düğümlere indirger", () => {
  const gaps = structuralGaps(
    [node({ id: "a", content: "[[b]]" }), node({ id: "b", frontmatter: { stub: true } })],
    [
      { fromId: "a", toId: "b", type: "mentions", confidence: 0.7 },
      { fromId: "x", toId: "y", type: "contradicts", confidence: 1 },
    ]
  );
  assert.equal(gapsForNodes(gaps, ["a"]).length, 1); // sadece missing(b, ref a)
  assert.equal(gapsForNodes(gaps, ["zzz"]).length, 0);
});
