// test/obsidian.test.ts — Obsidian vault import converter (deterministik, fs'siz).
import { test } from "node:test";
import assert from "node:assert/strict";
import { obsidianToRecords } from "../src/connectors/obsidian.js";

const NOW = "2026-06-21T00:00:00Z";

test("obsidian: frontmatter type/tier + heading title + slug from path", () => {
  const recs = obsidianToRecords(
    [{ path: "Projects/Auth Service.md", content: "---\ntype: service\ntier: durable\n---\n# Auth\nThe auth service." }],
    { now: NOW }
  );
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.type, "service");
  assert.equal(r.tier, "durable");
  assert.equal(r.title, "Auth"); // ilk başlık
  assert.equal(r.slug, "working/obsidian/projects/auth-service");
  assert.equal(r.sourceId, "Projects/Auth Service.md");
});

test("obsidian: geçersiz type → note, frontmatter yok → working + dosya-adı başlık", () => {
  const recs = obsidianToRecords([{ path: "Quick Note.md", content: "just some text" }], { now: NOW });
  assert.equal(recs[0].type, "note");
  assert.equal(recs[0].tier, "working");
  assert.equal(recs[0].title, "Quick Note");
});

test("obsidian: [[Wikilink]] vault slug'ına çözülür; çözülemeyen düz metin kalır", () => {
  const recs = obsidianToRecords(
    [
      { path: "A.md", content: "See [[B]] and [[Missing Note]] and [[B|the bee]]." },
      { path: "B.md", content: "I am B." },
    ],
    { now: NOW }
  );
  const a = recs.find((r) => r.slug.endsWith("/a"))!;
  assert.ok(a.content.includes("[[working/obsidian/b]]"), "B çözüldü → slug");
  assert.ok(a.content.includes("Missing Note"), "çözülemeyen → düz metin");
  assert.ok(!a.content.includes("[[B]]"), "ham [[B]] kalmamalı");
});

test("obsidian: title önceliği frontmatter.title > heading > dosya adı", () => {
  const recs = obsidianToRecords([{ path: "x.md", content: "---\ntitle: Custom Title\n---\n# Heading\nbody" }], { now: NOW });
  assert.equal(recs[0].title, "Custom Title");
});
