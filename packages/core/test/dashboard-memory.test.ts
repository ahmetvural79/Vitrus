import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { MemoryApi } from "../src/api/memory.js";
import { buildDashboard, renderDashboardHtml } from "../src/api/dashboard.js";
import type { KnowledgeNode } from "../src/core/types.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function corpusEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
function n(slug: string, content: string, salience = 0.5): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug, type: "note", tier: "working", title: slug, content,
    frontmatter: {}, salience,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], contentHash: "",
  };
}

test("MemoryApi: Remember/Recall/Forget/Improve", async () => {
  const e = await corpusEngine();
  const mem = new MemoryApi(e);
  try {
    // Remember
    await mem.remember(n("working/m/note1", "Yeni karar [[durable/people/alice]] ile alındı.", 0.5));
    assert.ok(await e.getNode("working/m/note1"));
    // Recall
    const r = await mem.recall("yeni karar alice");
    assert.ok(Array.isArray(r.gaps) && Array.isArray(r.citations));
    // Improve: salience bump + not ekle → yeniden türetilir (yeni kenar)
    // (remember refreshSalience ile yeniden hesapladı; delta o değerin üstüne biner.)
    const before = (await e.getNode("working/m/note1"))!.salience;
    const improved = await mem.improve("working/m/note1", { salienceDelta: 0.4, appendNote: "Ek: [[durable/teams/platform]] onayladı." });
    assert.ok(Math.abs(improved.salience - Math.min(1, before + 0.4)) < 1e-6, `salience ${improved.salience}`);
    const edges = await e.getConnections("working/m/note1");
    assert.ok(edges.some((x) => x.toId === "durable/teams/platform"), "appendNote kenarı türedi");
    // Forget
    await mem.forget("working/m/note1");
    assert.equal(await e.getNode("working/m/note1"), null);
  } finally {
    await e.close();
  }
});

test("denetlenebilir chunk: getChunks + supportingChunks (skorlu sıralı)", async () => {
  const e = await corpusEngine();
  try {
    await e.putNode(n("working/m/long", ["# A", "rate limit ".repeat(120), "", "# B", "gateway incident ".repeat(120)].join("\n")));
    const all = await e.getChunks("working/m/long");
    assert.ok(all.length >= 2, "uzun düğüm çok chunk");
    const sup = await e.supportingChunks("working/m/long", "gateway incident");
    assert.ok(sup.length >= 2);
    for (let i = 1; i < sup.length; i++) assert.ok(sup[i - 1].score >= sup[i].score, "skora göre sıralı");
  } finally {
    await e.close();
  }
});

test("dashboard: veri toplanır + HTML bölümleri render olur (kaçışlı)", async () => {
  const e = await corpusEngine();
  try {
    await e.refreshEntities(); // import/dream'in yaptığı gibi entities tablosunu doldur
    // bir audit kaydı üret
    await e.search("incident", { limit: 5, principals: ["eng"], audit: true });
    const data = await buildDashboard(e, { focusSlug: "durable/policies/incident-response", focusQuery: "incident" });
    assert.ok(data.gaps.length > 0 && data.entities.length > 0);
    assert.ok(data.audit.length >= 1);
    assert.ok(data.focus && data.focus.chunks.length >= 1);
    const html = renderDashboardHtml(data);
    assert.match(html, /Team Dashboard/);
    assert.match(html, /brain doesn't know/);
    assert.match(html, /Auditable chunks/);
    assert.ok(!html.includes("<script>"), "kaçış");
  } finally {
    await e.close();
  }
});
