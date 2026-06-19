import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import type { KnowledgeNode } from "../src/core/types.js";

async function eng(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}
function node(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type: "person",
    tier: "working",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    contentHash: "",
  };
}

test("bi-temporal: değişen kenar geçersiz kılınır (silinmez) — şimdi=yeni, tarih=ikisi", async () => {
  const e = await eng();
  try {
    await e.putNode(node("working/test/p", "[[works_at::durable/companies/a]]"));
    await e.putNode(node("working/test/p", "[[works_at::durable/companies/b]]")); // değişti
    const current = await e.getConnections("working/test/p");
    assert.deepEqual(current.map((x) => x.toId), ["durable/companies/b"], "şimdi yalnız yeni");
    const history = await e.getConnections("working/test/p", 1, { includeExpired: true });
    assert.deepEqual(
      history.map((x) => x.toId).sort(),
      ["durable/companies/a", "durable/companies/b"],
      "tarih ikisini de korur (silinmedi)"
    );
  } finally {
    await e.close();
  }
});

test("bi-temporal asof: zaman-yolculuğu — o tarihte canlı kenarlar (getConnections + graphSnapshot)", async () => {
  const e = await eng();
  try {
    await e.putNode(node("working/test/p", "[[works_at::durable/companies/a]]"));
    await new Promise((r) => setTimeout(r, 12));
    const mid = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 12));
    await e.putNode(node("working/test/p", "[[works_at::durable/companies/b]]")); // a expire, b create

    // şimdi: yalnız b
    assert.deepEqual((await e.getConnections("working/test/p")).map((x) => x.toId), ["durable/companies/b"]);
    // as-of mid: a hâlâ canlı, b henüz oluşmamış → yalnız a
    const atMid = await e.getConnections("working/test/p", 1, { asof: mid });
    assert.deepEqual(atMid.map((x) => x.toId), ["durable/companies/a"], "as-of mid: yalnız a (b henüz yok)");
    // çok geçmiş: hiçbir kenar henüz yoktu → boş
    assert.equal((await e.getConnections("working/test/p", 1, { asof: "2000-01-01T00:00:00Z" })).length, 0);

    // graphSnapshot as-of mid: a kenarı VAR, b kenarı YOK
    const snap = await e.graphSnapshot({ asof: mid });
    const pairs = snap.edges.map((x) => `${x.from}->${x.to}`);
    assert.ok(pairs.some((p) => p.includes("durable/companies/a")), "snapshot as-of mid: a kenarı var");
    assert.ok(!pairs.some((p) => p.includes("durable/companies/b")), "snapshot as-of mid: b kenarı YOK");
  } finally {
    await e.close();
  }
});

test("bi-temporal: kaldırılan link expire; tekrar gelince revive", async () => {
  const e = await eng();
  try {
    await e.putNode(node("working/test/p", "bkz [[durable/x]]"));
    assert.equal((await e.getConnections("working/test/p")).length, 1);
    await e.putNode(node("working/test/p", "artık yok")); // link kaldırıldı → expire
    assert.equal((await e.getConnections("working/test/p")).length, 0, "şimdi geçerli kenar yok");
    await e.putNode(node("working/test/p", "yine [[durable/x]]")); // geri geldi → revive
    assert.equal((await e.getConnections("working/test/p")).length, 1, "revive");
  } finally {
    await e.close();
  }
});
