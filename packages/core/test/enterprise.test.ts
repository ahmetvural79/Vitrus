import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { routeSkills } from "../src/skill/route.js";
import { buildSkill } from "../src/skill/skill-export.js";
import { skillFileToMarkdown, parseSkillMarkdown } from "../src/skill/skill-file.js";
import type { KnowledgeNode, ThinkResult } from "../src/core/types.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function corpusEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
function n(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug, type: "note", tier: "working", title: slug, content,
    frontmatter: {}, salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], contentHash: "",
  };
}

test("SOC2 purge: soft-delete sonrası KALICI sil + cascade (chunks gider)", async () => {
  const e = await corpusEngine();
  try {
    await e.putNode(n("working/p/x", "silinecek içerik [[durable/y]]"));
    assert.ok((await e.getChunks("working/p/x")).length >= 1);
    await e.deleteNode("working/p/x"); // soft-delete
    const removed = await e.purge({ retentionDays: 0 });
    assert.ok(removed >= 1, "kalıcı silinen sayısı");
    assert.equal((await e.getChunks("working/p/x")).length, 0, "chunks cascade ile gitti");
    assert.equal(await e.purge({ retentionDays: 0 }), 0, "tekrar purge → 0");
  } finally {
    await e.close();
  }
});

test("retention: yeni soft-delete, retentionDays>0 ile korunur", async () => {
  const e = await corpusEngine();
  try {
    await e.putNode(n("working/p/recent", "yeni"));
    await e.deleteNode("working/p/recent");
    assert.equal(await e.purge({ retentionDays: 30 }), 0, "30g retention → yeni silinmez");
  } finally {
    await e.close();
  }
});

test("akıllı skill yönlendirme: yalnız ilgili skill (token tasarrufu)", () => {
  const skills = [
    { name: "incident-cozumu", description: "incident'ları çözer", triggers: ["incident", "kesinti"] },
    { name: "fatura-isleme", description: "fatura ve ödeme işler", triggers: ["fatura", "ödeme"] },
  ];
  const r = routeSkills("incident nasıl çözülür kesinti", skills);
  assert.equal(r[0].name, "incident-cozumu");
  assert.ok(!r.some((x) => x.name === "fatura-isleme"), "ilgisiz skill yüklenmez");
});

test("skills interop: SKILL.md round-trip (export → import)", () => {
  const r: ThinkResult = {
    answer: "x", citations: [{ nodeId: "a", slug: "durable/a", uri: null }],
    gaps: [], oldestSourceDays: 0, confidence: 0.5, mode: "business",
  };
  const skill = buildSkill("incident nasıl çözülür", r);
  const md = skillFileToMarkdown(skill);
  const parsed = parseSkillMarkdown(md);
  assert.equal(parsed.name, skill.name);
  assert.equal(parsed.description, skill.description);
  assert.deepEqual(parsed.tools, skill.tools);
  assert.deepEqual(parsed.triggers, skill.triggers);
  assert.deepEqual(parsed.provenance, skill.provenance);
});

test("multi-agent (izin-farkında): aynı beyin, iki kullanıcı farklı görür", async () => {
  const e = await corpusEngine();
  try {
    const INCIDENT = "durable/incidents/2026-05-12-gateway-outage"; // group:eng,oncall
    const eng = (await e.search("gateway incident", { limit: 20, principals: ["eng"] })).map((h) => h.node.slug);
    const outsider = (await e.search("gateway incident", { limit: 20, principals: ["__x__"] })).map((h) => h.node.slug);
    assert.ok(eng.includes(INCIDENT) && !outsider.includes(INCIDENT), "iki ajan farklı görünüm");
  } finally {
    await e.close();
  }
});
