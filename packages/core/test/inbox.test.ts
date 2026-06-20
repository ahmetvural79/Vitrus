// M3.5: capture (tek-not) + InboxConnector (drop klasör) — deterministik yakalama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRecord, InboxConnector } from "../src/connectors/inbox.js";
import { recordToNode } from "../src/connectors/types.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

test("captureRecord: deterministik slug (tarih+hash), başlık ilk satırdan, ACL owner→private", () => {
  const now = "2026-06-20T10:00:00.000Z";
  const a = captureRecord("# Toplantı notu\nyarın deploy", { now });
  const b = captureRecord("# Toplantı notu\nyarın deploy", { now });
  assert.equal(a.slug, b.slug, "aynı içerik+now → aynı slug (deterministik)");
  assert.match(a.slug, /^working\/captures\/2026-06-20-[0-9a-f]{8}$/);
  assert.equal(a.title, "Toplantı notu", "başlık ilk satırdan (# soyulur)");
  assert.equal(a.type, "note");
  assert.equal(a.tier, "working");
  assert.equal(a.acl[0].kind, "public", "owner yok → public");

  const priv = captureRecord("x", { now, owner: "alice" });
  assert.equal(priv.acl[0].kind, "user");
  assert.equal(priv.acl[0].principal, "alice");
});

test("InboxConnector: klasördeki metin dosyaları → working/inbox notları (dotfile/boş atlanır)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vitrus-inbox-"));
  writeFileSync(join(dir, "idea.md"), "# Fikir\nbir şey");
  writeFileSync(join(dir, "note.txt"), "düz not");
  writeFileSync(join(dir, ".DS_Store"), "junk"); // dotfile → atlanır
  writeFileSync(join(dir, "empty.md"), "   "); // boş içerik → atlanır
  const recs = await new InboxConnector(dir).fetch();
  assert.deepEqual(
    recs.map((r) => r.slug).sort(),
    ["working/inbox/idea", "working/inbox/note"]
  );
  const idea = recs.find((r) => r.slug === "working/inbox/idea")!;
  assert.equal(idea.title, "Fikir");
  assert.equal(idea.type, "note");
});

test("round-trip: capture → index → search bulur", async () => {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  try {
    const rec = captureRecord("kubernetes cluster upgrade plan for staging", { now: "2026-06-20T00:00:00.000Z" });
    await e.putNode(recordToNode("capture", rec));
    const hits = await e.search("kubernetes staging upgrade", { limit: 5 });
    assert.ok(hits.some((h) => h.node.slug === rec.slug), "capture edilen not aranabilmeli");
  } finally {
    await e.close();
  }
});
