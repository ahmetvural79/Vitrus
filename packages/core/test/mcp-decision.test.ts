import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { callTool } from "../src/mcp/tools.js";
import { slugToId } from "../src/sync/wikilinks.js";

// record_decision — Faz 1.2 "write-after-decide" döngüsü (brainincorp/Glen çekirdeği,
// ama Vitrus'ta provenance + yazma-anı gap/çelişki kontrolüyle).

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

type DecisionOut = { slug: string; persisted: string; conflicts: { kind: string; message: string }[]; superseded: string[] };

test("record_decision: durable/decisions altına yazar, markdown+index, reindex'te KALIR (sahiplik)", async () => {
  const brain = mkdtempSync(join(tmpdir(), "vitrus-dec-"));
  const store = new MarkdownStore(brain);
  const e1 = await freshEngine();
  try {
    const r = await callTool(
      e1,
      "record_decision",
      { decision: "Run payments active-active across two regions.", rationale: "Resilience to a regional outage.", title: "active active" },
      { store }
    );
    const out = r.structuredContent as DecisionOut;
    assert.equal(out.persisted, "markdown+index");
    assert.ok(out.slug.startsWith("durable/decisions/"), "karar durable/decisions altında olmalı");
    assert.ok(existsSync(join(brain, out.slug + ".md")), "markdown kaynağı yazılmalı");
    const node = await e1.getNode(out.slug);
    assert.ok(node, "indekste bulunmalı");
    assert.equal(node!.type, "decision");
    assert.equal(node!.tier, "durable");
    assert.match(node!.content, /## Rationale/, "gerekçe gövdede olmalı");

    // SAHİPLİK: indeksi at, yalnız markdown'dan yeniden kur → karar HÂLÂ orada.
    const e2 = await freshEngine();
    for (const { node: n, edges } of store.readAll()) await e2.putNode(n, edges);
    assert.ok(await e2.getNode(out.slug), "karar reindex sonrası korunmalı");
    await e2.close();
  } finally {
    await e1.close();
    rmSync(brain, { recursive: true, force: true });
  }
});

test("record_decision: supersedes → eski karar STALE işaretlenir (self-maintaining loop)", async () => {
  const e = await freshEngine();
  try {
    const old = await callTool(e, "record_decision", { decision: "Use a single region (eu-central).", title: "single region" }, {});
    const oldSlug = (old.structuredContent as DecisionOut).slug;

    const neu = await callTool(
      e,
      "record_decision",
      { decision: "Go active-active across two regions.", title: "active active", supersedes: oldSlug },
      {}
    );
    const out = neu.structuredContent as DecisionOut;
    assert.deepEqual(out.superseded, [slugToId(oldSlug)], "yeni karar eskisini supersede etmeli");

    const gaps = await e.findGaps();
    const stale = gaps.find((g) => g.kind === "stale" && g.relatedNodeIds.includes(slugToId(oldSlug)));
    assert.ok(stale, "eski karar gap raporunda 'stale' görünmeli");
  } finally {
    await e.close();
  }
});

test("record_decision: contradicts → yazma anında ÇELİŞKİ geri bildirilir (glass-box)", async () => {
  const e = await freshEngine();
  try {
    const a = await callTool(e, "record_decision", { decision: "Single region only.", title: "dec a" }, {});
    const aSlug = (a.structuredContent as DecisionOut).slug;

    const b = await callTool(
      e,
      "record_decision",
      { decision: "Two regions active-active.", title: "dec b", contradicts: aSlug },
      {}
    );
    const out = b.structuredContent as DecisionOut;
    assert.ok(out.conflicts.length >= 1, "çelişki yazma anında raporlanmalı");
    assert.equal(out.conflicts[0].kind, "contradiction");
  } finally {
    await e.close();
  }
});

test("record_decision: varsayılan ACL = yazan kimlik (private); başkası göremez (fail-closed)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(e, "record_decision", { decision: "Confidential board decision.", title: "secret dec" }, { principals: ["alice"] });
    const slug = (r.structuredContent as DecisionOut).slug;
    assert.ok(await e.getNode(slug, ["alice"]), "alice görmeli");
    assert.equal(await e.getNode(slug, ["bob"]), null, "bob GÖRMEMELİ (private)");
  } finally {
    await e.close();
  }
});

test("record_decision: sources iç slug → [[mentions]] alıntı kenarı kurar (provenance)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(
      e,
      "record_decision",
      { decision: "Adopt Postgres for the index.", title: "use postgres", sources: ["durable/people/alice", "https://adr.example/12"] },
      {}
    );
    const slug = (r.structuredContent as DecisionOut).slug;
    const node = await e.getNode(slug);
    assert.match(node!.content, /\[\[mentions::durable\/people\/alice\]\]/, "iç kaynak alıntı wikilink'i olmalı");
    assert.match(node!.content, /https:\/\/adr\.example\/12/, "dış kaynak link olarak korunmalı");
  } finally {
    await e.close();
  }
});

type SessionOut = { slug: string; persisted: string; expiresAt: string | null };

test("capture_session: working/sessions altına session düğümü + TTL (expiresAt) yazar", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(
      e,
      "capture_session",
      { summary: "Tried Redis cache first, reverted — added DB index instead.", title: "cache investigation", ttlDays: 14 },
      { principals: ["alice"] }
    );
    const out = r.structuredContent as SessionOut;
    assert.ok(out.slug.startsWith("working/sessions/"), "oturum working/sessions altında olmalı");
    assert.ok(out.expiresAt, "TTL → expiresAt set olmalı");
    const node = await e.getNode(out.slug, ["alice"]);
    assert.ok(node, "sahip görmeli");
    assert.equal(node!.type, "session");
    assert.equal(node!.tier, "working");
  } finally {
    await e.close();
  }
});

test("capture_session: PRIVATE (sahip) ACL — başkası göremez (fail-closed)", async () => {
  const e = await freshEngine();
  try {
    const r = await callTool(e, "capture_session", { summary: "alice'in özel muhakemesi", title: "private reasoning" }, { principals: ["alice"] });
    const slug = (r.structuredContent as SessionOut).slug;
    assert.ok(await e.getNode(slug, ["alice"]), "alice görmeli");
    assert.equal(await e.getNode(slug, ["bob"]), null, "bob GÖRMEMELİ (private)");
  } finally {
    await e.close();
  }
});
