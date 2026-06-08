import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../src/sync/lang-detect.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import type { KnowledgeNode } from "../src/core/types.js";

// --- birim (saf, deterministik) ---

test("detectLanguage: Türkçe içerik → tr", () => {
  assert.equal(detectLanguage("Bu bir incident runbook'u; kesinti nasıl çözülür?"), "tr");
});

test("detectLanguage: İngilizce içerik → en", () => {
  assert.equal(detectLanguage("This is the incident response runbook for the gateway outage."), "en");
});

test("detectLanguage: Türkçe'ye özgü harf kısa metinde güçlü sinyal", () => {
  assert.equal(detectLanguage("güvenlik açığı"), "tr"); // ü, ı, ğ
});

test("detectLanguage: boş / sinyalsiz → und", () => {
  assert.equal(detectLanguage(""), "und");
  assert.equal(detectLanguage("xyz 123 foo"), "und");
});

// --- entegrasyon (motor) ---

function node(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type: "note",
    tier: "working",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    contentHash: "h-" + slug,
  };
}

test("putNode/getNode: içerik dili tespit edilip kalıcı olur (round-trip)", async () => {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  try {
    await engine.putNode(node("working/tr", "Kesinti nasıl çözülür; bu runbook ile müdahale edilir."));
    await engine.putNode(node("working/en", "This runbook explains how the outage is resolved."));
    assert.equal((await engine.getNode("working/tr"))?.language, "tr");
    assert.equal((await engine.getNode("working/en"))?.language, "en");
  } finally {
    await engine.close();
  }
});

test("think: sorgu dili ThinkResult.lang olarak yüzeye çıkar (cevap dili sözleşmesi)", async () => {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  try {
    await engine.putNode(node("working/x", "incident response runbook outage gateway"));
    const r = await engine.think("kesinti nasıl çözülür müdahale");
    assert.equal(r.lang, "tr");
  } finally {
    await engine.close();
  }
});
