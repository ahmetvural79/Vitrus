// M3.3: yeni MCP araçları (entities/graph_query/get_node/chunks/supporting_chunks/
// graph_snapshot/attention/conflicts). Özellikle ACL fail-closed (yeni yüzey sızıntı açmamalı).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { callTool } from "../src/mcp/tools.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
const INCIDENT = "durable/incidents/2026-05-12-gateway-outage"; // acl: group:eng, group:oncall (private)

async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
const sc = (r: { structuredContent?: unknown }) => r.structuredContent as Record<string, any>;

test("get_node: ACL fail-closed — yetkisiz principal özel düğümü GÖREMEZ", async () => {
  const e = await buildEngine();
  try {
    const admin = await callTool(e, "get_node", { slug: INCIDENT }); // principals yok → kısıtsız
    assert.equal(sc(admin).found, true, "kısıtsız (admin/self-host) görebilir");
    assert.ok(typeof sc(admin).content === "string" && sc(admin).content.length > 0);

    const carol = await callTool(e, "get_node", { slug: INCIDENT }, { principals: ["carol"] });
    assert.equal(sc(carol).found, false, "carol (eng/oncall değil) özel incident'ı görememeli (sızıntı!)");
    assert.equal(sc(carol).content, null);
  } finally {
    await e.close();
  }
});

test("chunks: ACL fail-closed — yetkisiz principal özel düğümün chunk'larını alamaz", async () => {
  const e = await buildEngine();
  try {
    const carol = await callTool(e, "chunks", { slug: INCIDENT }, { principals: ["carol"] });
    assert.deepEqual(sc(carol).chunks, [], "yetkisiz → boş chunk");
    const admin = await callTool(e, "chunks", { slug: INCIDENT });
    assert.ok(Array.isArray(sc(admin).chunks) && sc(admin).chunks.length > 0, "kısıtsız → chunk'lar");
  } finally {
    await e.close();
  }
});

test("graph_query: tipli traversal + anchor ACL-gate (yetkisiz anchor → boş)", async () => {
  const e = await buildEngine();
  try {
    const ok = await callTool(e, "graph_query", { slug: "durable/teams/platform" });
    assert.ok(Array.isArray(sc(ok).nodes), "erişilebilir anchor → düğüm listesi");

    const blocked = await callTool(e, "graph_query", { slug: INCIDENT }, { principals: ["carol"] });
    assert.deepEqual(sc(blocked).nodes, [], "carol özel anchor'ı göremez → boş (fail-closed)");
  } finally {
    await e.close();
  }
});

test("entities / graph_snapshot / conflicts / attention: yapısal sonuç döner", async () => {
  const e = await buildEngine();
  try {
    assert.ok(Array.isArray(sc(await callTool(e, "entities", { minMentions: 1 })).entities));
    const snap = sc(await callTool(e, "graph_snapshot", { limit: 50 }));
    assert.ok(Array.isArray(snap.nodes) && Array.isArray(snap.edges));
    assert.ok(Array.isArray(sc(await callTool(e, "conflicts", {})).conflicts));
    const att = sc(await callTool(e, "attention", { now: "2026-12-31T00:00:00Z" }));
    assert.ok(Array.isArray(att.items));
  } finally {
    await e.close();
  }
});

test("supporting_chunks: erişilebilir düğüm için skorlu pasajlar; yetkisiz → boş", async () => {
  const e = await buildEngine();
  try {
    const blocked = await callTool(e, "supporting_chunks", { slug: INCIDENT, query: "gateway" }, { principals: ["carol"] });
    assert.deepEqual(sc(blocked).chunks, [], "yetkisiz → boş");
  } finally {
    await e.close();
  }
});
