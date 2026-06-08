import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIEmbedder, embedderFromEnv, type FetchLike } from "../src/core/openai-embedder.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

/** Offline fake: encodes each input's length in embedding[0], returns the array in
 *  REVERSED order with CORRECT `index` — so the test proves we restore input order. */
function makeFetch(cap: { url?: string; body?: any }): FetchLike {
  return async (url, init) => {
    cap.url = url;
    cap.body = JSON.parse(init.body);
    const inputs: string[] = cap.body.input;
    const data = inputs.map((t, i) => ({
      index: i,
      embedding: Array.from({ length: cap.body.dimensions }, (_, d) => (d === 0 ? t.length : 0)),
    }));
    data.reverse();
    return { ok: true, status: 200, async text() { return ""; }, async json() { return { data }; } };
  };
}

test("OpenAIEmbedder: multilingual request + restores input order from shuffled response", async () => {
  const cap: { url?: string; body?: any } = {};
  const emb = new OpenAIEmbedder({ apiKey: "sk-test", fetchImpl: makeFetch(cap) });
  assert.equal(emb.dim, 1536);

  const inputs = ["merhaba dünya", "hello world", "你好"];
  const out = await emb.embed(inputs);

  assert.equal(cap.url, "https://api.openai.com/v1/embeddings");
  assert.equal(cap.body.model, "text-embedding-3-small"); // multilingual default
  assert.deepEqual(cap.body.input, inputs);
  assert.equal(cap.body.dimensions, 1536);

  assert.equal(out.length, 3);
  assert.equal(out[0].length, 1536);
  // Order restored: out[k] is the embedding of inputs[k] (emb[0] encodes input length).
  assert.equal(out[0][0], inputs[0].length);
  assert.equal(out[1][0], inputs[1].length);
  assert.equal(out[2][0], inputs[2].length);
});

test("OpenAIEmbedder: empty input → no network call", async () => {
  let called = false;
  const emb = new OpenAIEmbedder({
    apiKey: "x",
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, async text() { return ""; }, async json() { return { data: [] }; } };
    },
  });
  assert.deepEqual(await emb.embed([]), []);
  assert.equal(called, false);
});

test("OpenAIEmbedder: HTTP error surfaces (fail loud, no silent garbage vectors)", async () => {
  const emb = new OpenAIEmbedder({
    apiKey: "x",
    fetchImpl: async () => ({ ok: false, status: 429, async text() { return "rate limited"; }, async json() { return {}; } }),
  });
  await assert.rejects(() => emb.embed(["x"]), /HTTP 429/);
});

test("OpenAIEmbedder: custom baseUrl + dim honored (Azure/proxy/large model)", async () => {
  const cap: { url?: string; body?: any } = {};
  const emb = new OpenAIEmbedder({ apiKey: "k", dim: 3072, baseUrl: "https://proxy.local/v1/", fetchImpl: makeFetch(cap) });
  await emb.embed(["x"]);
  assert.equal(emb.dim, 3072);
  assert.equal(cap.url, "https://proxy.local/v1/embeddings"); // trailing slash trimmed
  assert.equal(cap.body.dimensions, 3072);
});

test("embedderFromEnv: no key → HashingEmbedder (offline determinism preserved)", () => {
  assert.ok(embedderFromEnv({}) instanceof HashingEmbedder);
});

test("embedderFromEnv: OPENAI_API_KEY → OpenAIEmbedder (multilingual production default)", () => {
  assert.ok(embedderFromEnv({ OPENAI_API_KEY: "sk-x" }) instanceof OpenAIEmbedder);
});
