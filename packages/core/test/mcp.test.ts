import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { TOOL_DEFS, callTool, nodeUri } from "../src/mcp/tools.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");

async function buildEngine(): Promise<PgliteEngine> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await engine.putNode(node, edges);
  return engine;
}

function rlinks(content: unknown[]): any[] {
  return (content as any[]).filter((c) => c.type === "resource_link");
}

test("TOOL_DEFS: 27 tool, her birinde inputSchema + outputSchema", () => {
  assert.equal(TOOL_DEFS.length, 27);
  for (const t of TOOL_DEFS) {
    assert.ok(t.inputSchema && t.inputSchema.type === "object", `${t.name} inputSchema`);
    assert.ok(t.outputSchema && t.outputSchema.type === "object", `${t.name} outputSchema`);
  }
  assert.deepEqual(
    TOOL_DEFS.map((t) => t.name).sort(),
    ["api_call", "api_describe", "api_search", "api_verify", "attention", "capture_session", "chunks", "conflicts", "entities", "forget", "gap_report", "get_node", "graph_query", "graph_snapshot", "improve", "onboarding_path", "ops_report", "provenance", "quiz", "record_decision", "remember", "resolve_conflict", "search", "skill_export", "supporting_chunks", "think", "verify"]
  );
});

test("search: yapısal hits + kaynak resource_link'leri", async () => {
  const engine = await buildEngine();
  try {
    const r = await callTool(engine, "search", { query: "platform servis", limit: 5 });
    const sc = r.structuredContent as { hits: any[] };
    assert.ok(sc.hits.length > 0);
    assert.ok("score" in sc.hits[0] && "slug" in sc.hits[0]);
    assert.ok(rlinks(r.content).length > 0, "resource_link olmalı");
  } finally {
    await engine.close();
  }
});

test("think: görünürlük yüzeyi (answer + cards + gaps) + citation link'leri", async () => {
  const engine = await buildEngine();
  try {
    const r = await callTool(engine, "think", { query: "incident nasıl çözülür" });
    const sc = r.structuredContent as any;
    assert.ok(typeof sc.answer === "string" && sc.answer.length > 0);
    assert.ok(sc.cards && typeof sc.cards.confidence === "number");
    assert.ok(Array.isArray(sc.gaps));
    assert.ok(rlinks(r.content).length > 0);
  } finally {
    await engine.close();
  }
});

test("gap_report: korpus boşluklarını yapısal döndürür", async () => {
  const engine = await buildEngine();
  try {
    const r = await callTool(engine, "gap_report", {});
    const sc = r.structuredContent as { gaps: any[] };
    assert.ok(sc.gaps.some((g) => g.kind === "missing" && g.message.includes("status-page")));
  } finally {
    await engine.close();
  }
});

test("provenance: var olan düğüm found:true + resource_link; yok → found:false", async () => {
  const engine = await buildEngine();
  try {
    const ok = await callTool(engine, "provenance", { slug: "durable/incidents/2026-05-12-gateway-outage" });
    const sc = ok.structuredContent as any;
    assert.equal(sc.found, true);
    assert.equal(sc.connector, "slack");
    assert.equal(rlinks(ok.content)[0].uri, "https://example.slack.com/archives/C0PLATFORM/p1715500000");

    const miss = await callTool(engine, "provenance", { slug: "yok/bisey" });
    assert.equal((miss.structuredContent as any).found, false);
  } finally {
    await engine.close();
  }
});

test("skill_export: geçerli SKILL.md + dosya listesi (canlı tool çağrılı)", async () => {
  const engine = await buildEngine();
  try {
    const r = await callTool(engine, "skill_export", { topic: "incident nasıl çözülür" });
    const sc = r.structuredContent as any;
    assert.equal(sc.valid, true);
    assert.equal(r.isError, false);
    assert.match(sc.skillMd, /Vitrus:search/);
    assert.ok(sc.files.includes("incident-nasil-cozulur/SKILL.md"));
  } finally {
    await engine.close();
  }
});

test("nodeUri: vitrus şeması", () => {
  assert.equal(nodeUri("durable/x"), "vitrus://node/durable/x");
});
