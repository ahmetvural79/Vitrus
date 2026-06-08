import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const brainDir = join(here, "..", "brain");

/** Depodan (kaynak-üstü) bellek-içi türev indeksi kurar. */
async function buildEngine(): Promise<PgliteEngine> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() }); // bellek-içi
  await engine.init();
  const store = new MarkdownStore(brainDir);
  for (const { node, edges } of store.readAll()) await engine.putNode(node, edges);
  return engine;
}

test("hibrit arama sonuç döndürür ve beklenen düğümü üste taşır", async () => {
  const engine = await buildEngine();
  try {
    const hits = await engine.search("platform ekibi servis", { limit: 10 });
    assert.ok(hits.length > 0, "sonuç gelmeli");
    assert.equal(hits[0].node.slug, "durable/teams/platform");
    // glass-box şeffaflık: tier boost + cosine boosts'ta görünür
    assert.ok(hits[0].boosts?.tier === 1.15); // durable
    assert.ok(typeof hits[0].boosts?.cosine === "number");
  } finally {
    await engine.close();
  }
});

test("İNDEKS ATILABİLİR invariantı: depodan yeniden kurulunca sonuçlar değişmez", async () => {
  const a = await buildEngine();
  const b = await buildEngine(); // ayrı, taze indeks — aynı kaynaktan
  try {
    for (const q of ["platform ekibi servis", "gateway", "alice on-call"]) {
      const ra = (await a.search(q)).map((h) => ({ slug: h.node.slug, s: h.score.toFixed(5) }));
      const rb = (await b.search(q)).map((h) => ({ slug: h.node.slug, s: h.score.toFixed(5) }));
      assert.deepEqual(ra, rb, `"${q}" için yeniden kurulan indeks aynı sonucu vermeli`);
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test("eksik kenar hedefi için stub düğüm açılır (FK + gap temeli)", async () => {
  const engine = await buildEngine();
  try {
    // incident → [[durable/services/status-page]] (dosyası yok) → stub açılmalı
    const targets = await engine.graphQuery("durable/incidents/2026-05-12-gateway-outage");
    const stub = targets.find((t) => t.slug === "durable/services/status-page");
    assert.ok(stub, "status-page hedefi olmalı");
    assert.equal(stub!.frontmatter.stub, true, "belgelenmemiş hedef stub olmalı");
    // gerçek dosyası olan hedef (auth) stub OLMAMALI
    const authTargets = await engine.graphQuery("durable/services/api-gateway", "depends_on");
    const auth = authTargets.find((t) => t.slug === "durable/services/auth");
    assert.ok(auth && auth.frontmatter.stub !== true, "auth gerçek düğüm, stub değil");
  } finally {
    await engine.close();
  }
});

test("findGaps korpustaki boşlukları bulur (missing/contradiction/stale/single_point)", async () => {
  const engine = await buildEngine();
  try {
    const gaps = await engine.findGaps();
    assert.ok(
      gaps.some((g) => g.kind === "missing" && g.message.includes("status-page")),
      "belgelenmemiş status-page → missing"
    );
    assert.ok(gaps.some((g) => g.kind === "contradiction"), "postmortem ↔ 0007 → contradiction");
    assert.ok(
      gaps.some((g) => g.kind === "stale" && g.message.includes("0003")),
      "0003 süpersede edildi → stale"
    );
    assert.ok(gaps.some((g) => g.kind === "single_point"), "policy tek-nokta → single_point");
  } finally {
    await engine.close();
  }
});

test("think: cevaba ilgili boşlukları + tazelik döndürür", async () => {
  const engine = await buildEngine();
  try {
    const r = await engine.think("gateway kesinti incident", { limit: 10 });
    assert.ok(r.citations.some((c) => c.slug.includes("incidents/2026-05-12")), "incident alıntılanmalı");
    // incident, belgelenmemiş status-page'e referans verdiği için missing boşluğu ilgilidir
    assert.ok(r.gaps.some((g) => g.message.includes("status-page")));
    assert.ok(r.oldestSourceDays >= 0);
  } finally {
    await engine.close();
  }
});

test("getConnections çok-atlamalı graf gezer", async () => {
  const engine = await buildEngine();
  try {
    const edges = await engine.getConnections("durable/incidents/2026-05-12-gateway-outage", 2);
    // incident → (resolved_by alice, caused_by decision, mentions service/team) + 2. hop
    const types = new Set(edges.map((e) => e.type));
    assert.ok(types.has("resolved_by"));
    assert.ok(types.has("caused_by"));
  } finally {
    await engine.close();
  }
});

test("T7: refreshEntities graftan varlık çıkarır (mention_count, sıralı)", async () => {
  const engine = await buildEngine();
  try {
    await engine.refreshEntities();
    const ents = await engine.listEntities(1);
    assert.ok(ents.length > 0, "varlık üretilmeli");
    const alice = ents.find((e) => e.entityType === "person" && /Alice/i.test(e.name));
    assert.ok(alice && alice.mentionCount >= 2, `alice çok referanslı olmalı (${alice?.mentionCount})`);
    for (let i = 1; i < ents.length; i++)
      assert.ok(ents[i - 1].mentionCount >= ents[i].mentionCount, "sıklığa göre sıralı");
  } finally {
    await engine.close();
  }
});

test("T6: uzun çok-bölümlü düğüm chunk'lanır ve aranabilir kalır", async () => {
  const engine = await buildEngine();
  try {
    const long = ["# Bölüm 1", "rate limit ".repeat(150), "", "# Bölüm 2", "gateway incident ".repeat(150)].join("\n");
    await engine.putNode({
      slug: "working/test/long",
      type: "document",
      tier: "working",
      title: "Uzun belge",
      content: long,
      frontmatter: {},
      salience: 0.5,
      provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
      acl: [],
      contentHash: "h",
    });
    const hits = await engine.search("gateway incident", { limit: 10 });
    assert.ok(hits.some((h) => h.node.slug === "working/test/long"), "uzun düğüm bulunmalı");
  } finally {
    await engine.close();
  }
});
