// src/security/cross-tenant-test.ts
// Çok-kiracılı sızıntı harness'ı (D1). Tek-kiracı leak-test'in (ACL) çok-kiracı genişlemesi:
// AYNI DB'de iki org (A, B) seed edilir; her org'un motoru DİĞERİNİN verisini HİÇBİR okuma yolundan
// (search · getNode · graphQuery · getConnections · getChunks · think · listEntities) göremez.
// org NULL (admin/tek-kiracı) HER İKİSİNİ görür (kısıtsız invariant korunur). Sızıntı = 0 → 5. CI kapısı.

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { PgliteEngine } from "../core/pglite-engine.js";
import { PgliteDriver } from "../core/sql-driver.js";
import { HashingEmbedder } from "../core/hashing-embedder.js";
import type { KnowledgeNode } from "../core/types.js";

export interface CrossTenantResult {
  checks: number;
  leaks: number;
  details: string[];
}

function node(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type: "note",
    tier: "durable",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: "t", sourceId: slug, uri: null, capturedAt: null },
    acl: [{ kind: "public", principal: "PUBLIC" }], // ACL'i açık tut → yalnız ORG izolasyonunu ölç
    contentHash: "h-" + slug,
  };
}

export async function runCrossTenantTest(): Promise<CrossTenantResult> {
  const pg = new PGlite({ extensions: { vector } });
  const driver = new PgliteDriver(pg);
  const embedder = new HashingEmbedder();

  const admin = new PgliteEngine({ embedder, driver }); // org yok → kısıtsız
  await admin.init();
  const A = new PgliteEngine({ embedder, driver, org: "orgA" });
  const B = new PgliteEngine({ embedder, driver, org: "orgB" });

  // İki kiracı AYNI slug'ı kullanır (durable/secret/x) → tenant-scoped id (engine.qid: org öneki) sayesinde
  // ÇAKIŞMAZ; her biri kendi satırında yaşar (B, A'yı EZMEZ). Bu D1-sağlamlaştırmanın tam stresi.
  await A.putNode(node("durable/secret/x", "orgA gizli ödeme sırrı [[mentions::durable/people/alice]]"));
  await A.putNode(node("durable/people/alice", "orgA kişi Alice ödeme ekibi"));
  await B.putNode(node("durable/secret/x", "orgB gizli ödeme sırrı [[mentions::durable/people/bob]]")); // AYNI slug
  await B.putNode(node("durable/people/bob", "orgB kişi Bob ödeme ekibi"));
  await A.refreshEntities();
  await B.refreshEntities();

  const details: string[] = [];
  let checks = 0;
  let leaks = 0;
  const chk = (ok: boolean, msg: string) => {
    checks++;
    if (!ok) {
      leaks++;
      details.push("LEAK: " + msg);
    }
  };

  // 1) search — kiracı diğerinin içeriğini görmez, kendininkini kaybetmez
  const aHits = await A.search("gizli ödeme sırrı", { limit: 10 });
  chk(!aHits.some((h) => h.node.content.includes("orgB")), "A.search → orgB içeriği döndü");
  chk(aHits.some((h) => h.node.content.includes("orgA")), "A.search → kendi orgA düğümünü kaybetti (aşırı-filtre)");
  const bHits = await B.search("gizli ödeme sırrı", { limit: 10 });
  chk(!bHits.some((h) => h.node.content.includes("orgA")), "B.search → orgA içeriği döndü");

  // 2) getNode — AYNI slug iki org: her biri yalnız KENDİ içeriğini görür (namespacing → çakışma/ezme yok)
  const aNode = await A.getNode("durable/secret/x");
  chk(aNode != null && aNode.content.includes("orgA") && !aNode.content.includes("orgB"), "A.getNode → orgB içeriği/kayıp (ezildi mi?)");
  const bNode = await B.getNode("durable/secret/x");
  chk(bNode != null && bNode.content.includes("orgB") && !bNode.content.includes("orgA"), "B.getNode → orgA içeriği/kayıp");

  // 3) graphQuery / getConnections — çapraz-kiracı graf traversal yok (A'nın secret/x'i yalnız alice'e bağlı)
  const aGraph = await A.graphQuery("durable/secret/x");
  chk(!aGraph.some((n) => n.content.includes("orgB") || n.slug.includes("bob")), "A.graphQuery → orgB grafına ulaştı");
  const aConn = await A.getConnections("durable/people/bob");
  chk(aConn.length === 0, "A.getConnections → orgB kenarlarını gördü");

  // 4) getChunks — A, B'nin chunk'larını okuyamaz (bob orgB'de)
  chk((await A.getChunks("durable/people/bob")).length === 0, "A.getChunks → orgB chunk'larını okudu");

  // 5) think — cevap/boşluk orgB slug/içeriğini sızdırmaz
  const aThink = await A.think("gizli ödeme sırrı");
  const tBlob = aThink.answer + JSON.stringify(aThink.citations) + JSON.stringify(aThink.gaps);
  chk(!tBlob.includes("orgB") && !tBlob.includes("bob"), "A.think → orgB sızdırdı");

  // 6) listEntities — A yalnız kendi varlıklarını görür
  const aEnts = await A.listEntities(1);
  chk(!aEnts.some((e) => e.name.includes("bob")), "A.listEntities → orgB varlıklarını gördü");

  // 7) admin (org yok) HER İKİSİNİ görür — kısıtsız/tek-kiracı invariant korunur
  const adminHits = await admin.search("gizli ödeme sırrı", { limit: 10 });
  chk(
    adminHits.some((h) => h.node.content.includes("orgA")) && adminHits.some((h) => h.node.content.includes("orgB")),
    "admin (org yok) her iki kiracıyı görmedi (kısıtsız invariant bozuldu)"
  );

  await admin.close();
  return { checks, leaks, details };
}
