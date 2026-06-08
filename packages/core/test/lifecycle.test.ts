import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import type { KnowledgeNode } from "../src/core/types.js";

function node(slug: string, extra: Partial<KnowledgeNode> = {}): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type: "session",
    tier: "working",
    title: slug,
    content: "gateway incident debug " + slug,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: "sessions", sourceId: slug, uri: null, capturedAt: null },
    acl: [],
    contentHash: "h-" + slug,
    ...extra,
  };
}

async function engine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

test("expireStale: süresi geçmiş soft-delete; gelecekteki/süresiz korunur (B2 TTL)", async () => {
  const e = await engine();
  try {
    await e.putNode(node("working/sessions/old", { expiresAt: "2020-01-01T00:00:00Z" })); // geçmiş
    await e.putNode(node("working/sessions/new", { expiresAt: "2999-01-01T00:00:00Z" })); // gelecek
    await e.putNode(node("working/sessions/perma")); // expiresAt yok = süresiz

    const n = await e.expireStale();
    assert.equal(n, 1, "yalnız süresi geçen silinmeli");
    assert.equal(await e.getNode("working/sessions/old"), null); // soft-deleted
    assert.ok(await e.getNode("working/sessions/new")); // korundu
    assert.ok(await e.getNode("working/sessions/perma")); // süresiz korundu
  } finally {
    await e.close();
  }
});

test("scope filtresi: search yalnız istenen kapsam + global döner; diğer kapsam elenir (B2)", async () => {
  const e = await engine();
  try {
    await e.putNode(node("working/sessions/a", { scope: "proj-a" }));
    await e.putNode(node("working/sessions/b", { scope: "proj-b" }));
    await e.putNode(node("working/sessions/g")); // scope yok = global
    const slugs = (await e.search("gateway incident debug", { scope: "proj-a" })).map((h) => h.node.slug);
    assert.ok(slugs.includes("working/sessions/a"), "proj-a görünmeli");
    assert.ok(slugs.includes("working/sessions/g"), "global görünmeli");
    assert.ok(!slugs.includes("working/sessions/b"), "proj-b GÖRÜNMEMELİ (scope filtresi)");
  } finally {
    await e.close();
  }
});

test("putNode/getNode: scope + expiresAt round-trip", async () => {
  const e = await engine();
  try {
    await e.putNode(node("working/sessions/x", { scope: "proj-x", expiresAt: "2030-06-01T00:00:00Z" }));
    const got = await e.getNode("working/sessions/x");
    assert.equal(got?.scope, "proj-x");
    assert.match(got?.expiresAt ?? "", /^2030-06-01/);
  } finally {
    await e.close();
  }
});
