import { test } from "node:test";
import assert from "node:assert/strict";
import { LexicalReranker, HttpReranker, rerankerFromEnv } from "../src/core/reranker.js";
import type { FetchLike } from "../src/core/openai-embedder.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

const PRESET = { baseUrl: "https://x/rerank", defaultModel: "m", topParam: "top_n" as const, resultsKey: "results" as const };

test("LexicalReranker: token örtüşmesine göre yeniden sıralar", async () => {
  const r = new LexicalReranker();
  const out = await r.rerank("ödeme servisi kesinti", [
    { id: "a", text: "tatil planı ve yemek tarifleri" },
    { id: "b", text: "ödeme servisi kesinti raporu ve çözüm" },
    { id: "c", text: "ödeme gecikmesi" },
  ], 3);
  assert.equal(out[0].id, "b"); // en çok örtüşen
  assert.ok(out[0].score >= out[1].score);
});

test("HttpReranker: istek şekli (top_n + documents) + index→id eşleme + desc", async () => {
  const cap: any = {};
  const fetchImpl: FetchLike = async (url, init) => {
    cap.url = url; cap.body = JSON.parse(init.body); cap.auth = init.headers["authorization"];
    return { ok: true, status: 200, async text() { return ""; }, async json() {
      return { results: [{ index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.4 }] };
    } };
  };
  const r = new HttpReranker({ apiKey: "k", preset: PRESET, fetchImpl });
  const out = await r.rerank("q", [{ id: "x", text: "x" }, { id: "y", text: "y" }, { id: "z", text: "z" }], 2);
  assert.equal(cap.body.top_n, 2);
  assert.equal(cap.body.documents.length, 3);
  assert.equal(cap.auth, "Bearer k");
  assert.deepEqual(out.map((o) => o.id), ["z", "x"]); // index 2→z (0.9), 0→x (0.4)
});

test("HttpReranker: voyage preset 'data' anahtarını + top_k'yı okur", async () => {
  const voyage = { baseUrl: "https://v/rerank", defaultModel: "rerank-2.5", topParam: "top_k" as const, resultsKey: "data" as const };
  const cap: any = {};
  const fetchImpl: FetchLike = async (_url, init) => {
    cap.body = JSON.parse(init.body);
    return { ok: true, status: 200, async text() { return ""; }, async json() { return { data: [{ index: 0, relevance_score: 1 }] }; } };
  };
  const r = new HttpReranker({ apiKey: "k", preset: voyage, fetchImpl });
  const out = await r.rerank("q", [{ id: "x", text: "x" }], 5);
  assert.equal(cap.body.top_k, 1);
  assert.equal(out[0].id, "x");
});

test("HttpReranker: boş docs → ağ çağrısı yok", async () => {
  let called = false;
  const r = new HttpReranker({ apiKey: "k", preset: PRESET, fetchImpl: async () => { called = true; return { ok: true, status: 200, async text() { return ""; }, async json() { return {}; } }; } });
  assert.deepEqual(await r.rerank("q", [], 3), []);
  assert.equal(called, false);
});

test("rerankerFromEnv: varsayılan KAPALI (undefined); provider dispatch + hatalar", () => {
  assert.equal(rerankerFromEnv({}), undefined); // env yoksa reranker yok → search değişmez
  assert.ok(rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "lexical" }) instanceof LexicalReranker);
  assert.ok(rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "cohere", COHERE_API_KEY: "c" }) instanceof HttpReranker);
  assert.ok(rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "voyage", VOYAGE_API_KEY: "v" }) instanceof HttpReranker);
  assert.ok(rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "zeroentropy", ZEROENTROPY_API_KEY: "z" }) instanceof HttpReranker);
  assert.throws(() => rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "cohere" }), /COHERE_API_KEY/);
  assert.throws(() => rerankerFromEnv({ VITRUS_RERANK_PROVIDER: "bogus" }), /unknown/);
});

async function seed(engine: PgliteEngine, items: { slug: string; content: string }[]) {
  await engine.init();
  for (const it of items) {
    await engine.putNode({
      slug: it.slug, type: "note", tier: "working", title: it.slug, content: it.content,
      frontmatter: {}, salience: 0.5,
      provenance: { connector: "t", sourceId: it.slug, uri: null, capturedAt: null },
      acl: [], contentHash: "h-" + it.slug,
    });
  }
}

test("Motor entegrasyonu: reranker'sız değişmez, reranker'lı yeniden sıralar + boosts.rerank", async () => {
  const items = [
    { slug: "working/a", content: "tatil planı yemek tarifi" },
    { slug: "working/b", content: "ödeme servisi kesinti kök neden çözüm runbook" },
    { slug: "working/c", content: "ödeme küçük not" },
  ];

  // Reranker KAPALI: çalışır + boosts.rerank YOK (eval-değişmezlik garantisi).
  const plain = new PgliteEngine({ embedder: new HashingEmbedder() });
  await seed(plain, items);
  const baseHits = await plain.search("ödeme servisi kesinti çözüm", { limit: 5 });
  assert.ok(baseHits.length > 0);
  assert.equal(baseHits[0].boosts?.rerank, undefined);
  await plain.close();

  // Reranker AÇIK (lexical): en çok örtüşen 'b' tepeye gelir + boosts.rerank set.
  const reranked = new PgliteEngine({ embedder: new HashingEmbedder(), reranker: new LexicalReranker() });
  await seed(reranked, items);
  const rrHits = await reranked.search("ödeme servisi kesinti çözüm", { limit: 5 });
  assert.equal(rrHits[0].node.slug, "working/b");
  assert.notEqual(rrHits[0].boosts?.rerank, undefined);
  await reranked.close();
});
