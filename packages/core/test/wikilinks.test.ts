import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEdges, slugToId } from "../src/sync/wikilinks.js";

test("açık tip sözdizimi [[type::slug]] kenar tipini belirler", () => {
  const edges = extractEdges("a", "x [[resolved_by::durable/people/alice]] y");
  assert.equal(edges.length, 1);
  assert.equal(edges[0].type, "resolved_by");
  assert.equal(edges[0].toId, "durable/people/alice");
  assert.equal(edges[0].confidence, 1.0);
});

test("fiil ipucu tipi tahmin eder (LLM'siz)", () => {
  const edges = extractEdges("a", "Bob, [[durable/companies/acme]] şirketinde çalışıyor.");
  assert.equal(edges[0].type, "works_at");
});

test("ipucu yoksa mentions (düşük güven)", () => {
  const edges = extractEdges("a", "Bkz [[durable/x]].");
  assert.equal(edges[0].type, "mentions");
  assert.equal(edges[0].confidence, 0.7);
});

test("self-link atlanır, tip başına dedup", () => {
  const edges = extractEdges("durable/x", "[[durable/x]] ve [[durable/y]] ve yine [[durable/y]]");
  assert.equal(edges.length, 1);
  assert.equal(edges[0].toId, "durable/y");
});

test("unvan ('yöneticisi') reports_to tetiklemez — yön/anlam karışmasın", () => {
  const edges = extractEdges("a", "Mühendislik yöneticisi; [[durable/teams/platform]] ekibini yönetir.");
  assert.equal(edges[0].type, "mentions");
});

test("açık reports_to çalışır (org hiyerarşisi)", () => {
  const edges = extractEdges("a", "[[reports_to::durable/people/bob]] yöneticisine bağlı.");
  assert.equal(edges[0].type, "reports_to");
  assert.equal(edges[0].toId, "durable/people/bob");
});

test("geçersiz açık tip slug'ın parçası sayılır", () => {
  // "foo" geçerli EdgeType değil → tüm inner slug olarak kalır, mentions olur
  const edges = extractEdges("a", "[[foo::bar]]");
  assert.equal(edges[0].toId, "foo::bar");
  assert.equal(edges[0].type, "mentions");
});

test("slugToId normalize eder", () => {
  assert.equal(slugToId("/Durable/People/Alice/"), "durable/people/alice");
});
