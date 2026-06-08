import { test } from "node:test";
import assert from "node:assert/strict";
import { fileToNode, parseAcl, contentHash } from "../src/sync/markdown.js";

test("fileToNode: tier yoldan, type frontmatter'dan, title başlıktan", () => {
  const raw = `---\ntype: incident\nsalience: 0.7\n---\n\n# Gateway kesintisi\n\nGövde.`;
  const n = fileToNode("durable/incidents/x.md", raw);
  assert.equal(n.slug, "durable/incidents/x");
  assert.equal(n.tier, "durable");
  assert.equal(n.type, "incident");
  assert.equal(n.title, "Gateway kesintisi");
  assert.equal(n.salience, 0.7);
  // content gövdeyi (başlık dahil) korur; title ayrıca türetilir
  assert.equal(n.content, "# Gateway kesintisi\n\nGövde.");
});

test("fileToNode: geçersiz tier → working; type yoksa note", () => {
  const n = fileToNode("rastgele/x.md", "gövde");
  assert.equal(n.tier, "working");
  assert.equal(n.type, "note");
});

test("fileToNode: provenance frontmatter'dan", () => {
  const raw = `---\ntype: person\nconnector: slack\nsource_id: U0ALICE\nuri: https://s/x\ncaptured_at: 2026-05-12T09:30:00Z\n---\nx`;
  const n = fileToNode("durable/people/alice.md", raw);
  assert.equal(n.provenance.connector, "slack");
  assert.equal(n.provenance.sourceId, "U0ALICE");
  assert.equal(n.provenance.uri, "https://s/x");
  assert.equal(n.provenance.capturedAt, "2026-05-12T09:30:00Z");
});

test("parseAcl: user/group/public ayrıştırma; boş → []", () => {
  assert.deepEqual(parseAcl("group:eng, user:alice, public"), [
    { kind: "group", principal: "eng" },
    { kind: "user", principal: "alice" },
    { kind: "public", principal: "PUBLIC" },
  ]);
  assert.deepEqual(parseAcl(undefined), []);
});

test("contentHash: aynı gövde → aynı hash (idempotent)", () => {
  assert.equal(contentHash("abc"), contentHash("abc"));
  assert.notEqual(contentHash("abc"), contentHash("abd"));
});
