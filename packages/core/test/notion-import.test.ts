// test/notion-import.test.ts — Notion markdown export import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { notionToRecords } from "../src/connectors/notion-import.js";

const NOW = "2026-06-21T00:00:00Z";

test("notion-import: 32-hex id eki temizlenir → slug/başlık temiz", () => {
  const recs = notionToRecords(
    [{ path: "Auth Service 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md", content: "# Auth Service\nThe service." }],
    { now: NOW }
  );
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "Auth Service"); // ilk heading
  assert.equal(recs[0].slug, "working/notion/auth-service"); // hash atıldı
  assert.equal(recs[0].type, "note");
});

test("notion-import: [text](file.md) link vault-içi slug'a çözülür", () => {
  const recs = notionToRecords(
    [
      { path: "A 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md", content: "See [Database](Database%20a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md) for more." },
      { path: "Database a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md", content: "# Database\nthe store" },
    ],
    { now: NOW }
  );
  const a = recs.find((r) => r.slug.endsWith("/a"))!;
  assert.ok(a.content.includes("[[working/notion/database]]"), "link çözüldü → wikilink");
});

test("notion-import: heading yoksa temiz dosya adı başlık olur", () => {
  const recs = notionToRecords([{ path: "Quick Note deadbeefdeadbeefdeadbeefdeadbeef.md", content: "no heading here" }], { now: NOW });
  assert.equal(recs[0].title, "Quick Note");
});
