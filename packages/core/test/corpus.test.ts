import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MarkdownStore } from "../src/store/markdown-store.js";
import type { NodeType, EdgeType } from "../src/core/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const store = new MarkdownStore(join(here, "..", "brain"));
const all = store.readAll();

test("üç kademe de korpusta temsil edilir", () => {
  const tiers = new Set(all.map((n) => n.node.tier));
  for (const t of ["working", "derived", "durable"]) assert.ok(tiers.has(t as any), `eksik kademe: ${t}`);
});

test("çekirdek düğüm tipleri kapsanır", () => {
  const types = new Set<NodeType>(all.map((n) => n.node.type));
  const required: NodeType[] = [
    "person", "team", "service", "decision", "incident",
    "policy", "company", "concept", "meeting", "document",
  ];
  for (const t of required) assert.ok(types.has(t), `eksik tip: ${t}`);
});

test("çekirdek kenar tipleri kapsanır", () => {
  const edgeTypes = new Set<EdgeType>(all.flatMap((n) => n.edges.map((e) => e.type)));
  const required: EdgeType[] = [
    "member_of", "reports_to", "works_at", "owns", "depends_on",
    "decided_by", "supersedes", "caused_by", "resolved_by",
    "attended", "contradicts", "extends", "advises",
  ];
  for (const t of required) assert.ok(edgeTypes.has(t), `eksik kenar tipi: ${t}`);
});

test("slug'lar benzersiz", () => {
  const slugs = all.map((n) => n.node.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("yön doğruluğu: 0007 supersedes 0003 (tersi değil)", () => {
  const d7 = all.find((n) => n.node.slug === "durable/decisions/0007-rate-limit")!;
  const sup = d7.edges.find((e) => e.type === "supersedes");
  assert.ok(sup, "0007'de supersedes kenarı olmalı");
  assert.equal(sup!.toId, "durable/decisions/0003-rate-limit");
  // 0003'te supersedes OLMAMALI (yön karışmasın)
  const d3 = all.find((n) => n.node.slug === "durable/decisions/0003-rate-limit")!;
  assert.ok(!d3.edges.some((e) => e.type === "supersedes"));
});

test("açık tipli kenarlar güven=1.0", () => {
  const alice = all.find((n) => n.node.slug === "durable/people/alice")!;
  const reportsTo = alice.edges.find((e) => e.type === "reports_to")!;
  assert.equal(reportsTo.confidence, 1.0);
  assert.equal(reportsTo.toId, "durable/people/bob");
});
