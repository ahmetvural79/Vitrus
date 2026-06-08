import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { callTool } from "../src/mcp/tools.js";

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

// Ajan MCP üzerinden YAZAR (remember) — GBrain paritesi.

test("remember: markdown KAYNAĞINA + indekse yazar ve reindex'te KALIR (sahiplik)", async () => {
  const brain = mkdtempSync(join(tmpdir(), "vitrus-brain-"));
  const store = new MarkdownStore(brain);
  const e1 = await freshEngine();
  try {
    const r = await callTool(e1, "remember", { content: "Gateway 503 kök neden auth latency p99.", title: "gateway 503 kok neden" }, { store });
    assert.equal((r.structuredContent as { persisted: string }).persisted, "markdown+index");
    const slug = (r.structuredContent as { slug: string }).slug;
    assert.ok(existsSync(join(brain, slug + ".md")), "markdown dosyası yazılmalı");
    assert.ok(await e1.getNode(slug), "indekste bulunmalı");

    // SAHİPLİK: indeksi at, yalnız markdown'dan yeniden kur → hafıza HÂLÂ orada.
    const e2 = await freshEngine();
    for (const { node, edges } of store.readAll()) await e2.putNode(node, edges);
    assert.ok(await e2.getNode(slug), "remembered düğüm reindex sonrası korunmalı");
    await e2.close();
  } finally {
    await e1.close();
    rmSync(brain, { recursive: true, force: true });
  }
});

test("remember: varsayılan ACL = yazan kimlik (private); başkası göremez (fail-closed)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(e, "remember", { content: "alice'in gizli özel notu", title: "ozel not" }, { principals: ["alice"] });
    const slug = (r.structuredContent as { slug: string }).slug;
    assert.ok(await e.getNode(slug, ["alice"]), "alice görmeli");
    assert.equal(await e.getNode(slug, ["bob"]), null, "bob GÖRMEMELİ (private)");
  } finally {
    await e.close();
  }
});

test("forget: erişilebilen düğümü siler + markdown'dan kaldırır", async () => {
  const brain = mkdtempSync(join(tmpdir(), "vitrus-brain-"));
  const store = new MarkdownStore(brain);
  const e = await freshEngine();
  try {
    const r = await callTool(e, "remember", { content: "geçici not silinecek", title: "gecici" }, { store });
    const slug = (r.structuredContent as { slug: string }).slug;
    assert.ok(existsSync(join(brain, slug + ".md")));
    const f = await callTool(e, "forget", { slug }, { store });
    assert.equal((f.structuredContent as { forgotten: boolean }).forgotten, true);
    assert.equal(await e.getNode(slug), null, "indeksten silinmeli");
    assert.ok(!existsSync(join(brain, slug + ".md")), "markdown da silinmeli (reindex'te geri gelmesin)");
  } finally {
    await e.close();
    rmSync(brain, { recursive: true, force: true });
  }
});

test("forget: erişilemeyen/olmayan düğüm → forgotten:false (fail-closed)", async () => {
  const e = await freshEngine();
  try {
    const f = await callTool(e, "forget", { slug: "working/yok/olmayan" }, { principals: ["x"] });
    assert.equal((f.structuredContent as { forgotten: boolean }).forgotten, false);
  } finally {
    await e.close();
  }
});

test("improve: içeriğe not ekler (geri besleme)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(e, "remember", { content: "ilk içerik", title: "iyilestir" }, {});
    const slug = (r.structuredContent as { slug: string }).slug;
    await callTool(e, "improve", { slug, appendNote: "ek bilgi satırı" }, {});
    const node = await e.getNode(slug);
    assert.match(node!.content, /ek bilgi satırı/);
  } finally {
    await e.close();
  }
});
