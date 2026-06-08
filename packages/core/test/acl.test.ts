import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
const INCIDENT = "durable/incidents/2026-05-12-gateway-outage"; // acl: group:eng, group:oncall (private)
const Q = "gateway kesinti incident 503";

async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}
const slugs = (hits: { node: { slug: string } }[]) => hits.map((h) => h.node.slug);

test("SIZINTI YOK: yetkisiz kullanıcı özel düğümü retrieval'da GÖREMEZ", async () => {
  const e = await buildEngine();
  try {
    const hits = await e.search(Q, { limit: 20, principals: ["carol"] }); // carol ∉ eng/oncall
    assert.ok(!slugs(hits).includes(INCIDENT), "özel incident dönmemeli (sızıntı!)");
    assert.ok(slugs(hits).length > 0, "public düğümler yine dönmeli");
  } finally {
    await e.close();
  }
});

test("YETKİLİ GÖRÜR: eng grubu özel düğümü görür", async () => {
  const e = await buildEngine();
  try {
    const hits = await e.search(Q, { limit: 20, principals: ["eng"] });
    assert.ok(slugs(hits).includes(INCIDENT), "eng incident'i görmeli");
  } finally {
    await e.close();
  }
});

test("PUBLIC herkese açık; FAIL-CLOSED boş principal → yalnız public", async () => {
  const e = await buildEngine();
  try {
    const pub = await e.search("platform servis", { limit: 20, principals: ["hic-kimse"] });
    assert.ok(slugs(pub).includes("durable/teams/platform"), "public görünmeli");

    const closed = await e.search(Q, { limit: 20, principals: [] }); // fail-closed
    assert.ok(!slugs(closed).includes(INCIDENT), "boş principal özel düğüm sızdırmamalı");
    assert.ok(slugs(closed).every((s) => s !== "durable/people/alice"), "alice (group:eng) de gizli");
  } finally {
    await e.close();
  }
});

test("KISITSIZ: principals verilmezse her şey (CLI/eval/admin davranışı korunur)", async () => {
  const e = await buildEngine();
  try {
    const hits = await e.search(Q, { limit: 20 });
    assert.ok(slugs(hits).includes(INCIDENT), "principals yoksa kısıtsız");
  } finally {
    await e.close();
  }
});

test("getNode ACL: yetkisiz → null; yetkili → düğüm; kısıtsız → düğüm", async () => {
  const e = await buildEngine();
  try {
    assert.equal(await e.getNode(INCIDENT, ["carol"]), null, "yetkisiz null");
    assert.ok(await e.getNode(INCIDENT, ["oncall"]), "oncall görür");
    assert.ok(await e.getNode(INCIDENT), "kısıtsız görür");
  } finally {
    await e.close();
  }
});

test("GRUP ÜYELİĞİ: setGroupMembers + expandPrincipals erişim verir", async () => {
  const e = await buildEngine();
  try {
    // carol'u eng grubuna ekle → genişletilmiş principal'la incident'i görür
    await e.setGroupMembers("eng", ["carol"]);
    const principals = await e.expandPrincipals("carol");
    assert.ok(principals.includes("eng"), "carol artık eng üyesi");
    const hits = await e.search(Q, { limit: 20, principals });
    assert.ok(slugs(hits).includes(INCIDENT), "üyelik erişim vermeli");
  } finally {
    await e.close();
  }
});
