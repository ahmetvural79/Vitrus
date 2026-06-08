import { test } from "node:test";
import assert from "node:assert/strict";
import type { SearchHit, KnowledgeNode } from "../src/core/types.js";
import { GeminiEmbedder } from "../src/core/providers/gemini-embedder.js";
import { CohereEmbedder } from "../src/core/providers/cohere-embedder.js";
import { AnthropicSynthesizer } from "../src/core/providers/anthropic-synthesizer.js";
import { GeminiSynthesizer } from "../src/core/providers/gemini-synthesizer.js";
import { embedderFromEnv, OpenAIEmbedder } from "../src/core/openai-embedder.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { synthesizerFromEnv, LLMSynthesizer } from "../src/core/llm-synthesizer.js";
import { ExtractiveSynthesizer } from "../src/core/synthesizer.js";
import type { FetchLike } from "../src/core/openai-embedder.js";

function hit(slug: string, content: string): SearchHit {
  const node: KnowledgeNode = {
    id: slug, slug, type: "note", tier: "durable", title: slug, content,
    frontmatter: {}, salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], createdAt: "", updatedAt: "", contentHash: "",
  };
  return { node, score: 0.1 };
}

/** Sahte fetch: isteği yakalar, canned JSON döner. */
function fakeFetch(json: unknown, cap: { url?: string; headers?: Record<string, string>; body?: any } = {}): FetchLike {
  return async (url, init) => {
    cap.url = url;
    cap.headers = init.headers;
    cap.body = JSON.parse(init.body);
    return { ok: true, status: 200, async text() { return ""; }, async json() { return json; } };
  };
}

const isUnit = (v: number[]) => {
  let n = 0;
  for (const x of v) n += x * x;
  return Math.abs(Math.sqrt(n) - 1) < 1e-6;
};

// --- Embedders -------------------------------------------------------------

test("GeminiEmbedder: batchEmbedContents istek şekli + outputDimensionality + L2 normalize", async () => {
  const cap: any = {};
  const e = new GeminiEmbedder({
    apiKey: "k", dim: 4,
    fetchImpl: fakeFetch({ embeddings: [{ values: [3, 0, 0, 4] }, { values: [0, 0, 0, 2] }] }, cap),
  });
  const out = await e.embed(["a", "b"]);
  assert.match(cap.url, /gemini-embedding-001:batchEmbedContents$/);
  assert.equal(cap.headers["x-goog-api-key"], "k");
  assert.equal(cap.body.requests[0].outputDimensionality, 4);
  assert.equal(cap.body.requests.length, 2);
  assert.equal(out.length, 2);
  assert.ok(isUnit(out[0])); // [3,0,0,4] → /5 → unit
  assert.equal(out[0][0], 0.6);
});

test("GeminiEmbedder: boş girdi → ağ çağrısı yok", async () => {
  let called = false;
  const e = new GeminiEmbedder({ apiKey: "k", fetchImpl: async () => { called = true; return { ok: true, status: 200, async text() { return ""; }, async json() { return {}; } }; } });
  assert.deepEqual(await e.embed([]), []);
  assert.equal(called, false);
});

test("CohereEmbedder: /embed istek şekli (input_type + output_dimension) + parse", async () => {
  const cap: any = {};
  const e = new CohereEmbedder({
    apiKey: "k", dim: 4, model: "embed-v4.0",
    fetchImpl: fakeFetch({ embeddings: { float: [[1, 0, 0, 0]] } }, cap),
  });
  const out = await e.embed(["x"]);
  assert.match(cap.url, /\/embed$/);
  assert.equal(cap.headers["authorization"], "Bearer k");
  assert.equal(cap.body.output_dimension, 4);
  assert.equal(cap.body.input_type, "search_document");
  assert.deepEqual(cap.body.embedding_types, ["float"]);
  assert.ok(isUnit(out[0]));
});

// --- Synthesizers (grounding sözleşmesi korunur) ---------------------------

test("AnthropicSynthesizer: Messages API şekli + [n] grounding sabit-eşleme", async () => {
  const cap: any = {};
  const s = new AnthropicSynthesizer({
    apiKey: "sk", model: "claude-haiku-4-5",
    fetchImpl: fakeFetch({ content: [{ type: "text", text: "Limit 500 rps [1]." }] }, cap),
  });
  const out = await s.synthesize("limit", [hit("durable/decisions/7", "Rate-limit 500 rps.")], { lang: "en" });
  assert.match(cap.url, /\/v1\/messages$/);
  assert.equal(cap.headers["x-api-key"], "sk");
  assert.equal(cap.headers["anthropic-version"], "2023-06-01");
  assert.equal(cap.body.system.includes('"en"'), true);
  assert.match(cap.body.messages[0].content, /durable\/decisions\/7/);
  assert.equal(cap.body.temperature, 0);
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].slug, "durable/decisions/7");
  assert.match(out.answer, /\[1\]/);
});

test("AnthropicSynthesizer: kaynak yoksa çağrı YOK, dürüst not-found", async () => {
  let called = false;
  const s = new AnthropicSynthesizer({ apiKey: "x", fetchImpl: async () => { called = true; return { ok: true, status: 200, async text() { return ""; }, async json() { return {}; } }; } });
  const out = await s.synthesize("q", [], { lang: "en" });
  assert.equal(called, false);
  assert.match(out.answer, /No sourced content/);
});

test("GeminiSynthesizer: generateContent şekli + parse + grounding", async () => {
  const cap: any = {};
  const s = new GeminiSynthesizer({
    apiKey: "g",
    fetchImpl: fakeFetch({ candidates: [{ content: { parts: [{ text: "Cevap [1]." }] } }] }, cap),
  });
  const out = await s.synthesize("soru", [hit("durable/x/1", "içerik")], { lang: "tr" });
  assert.match(cap.url, /:generateContent$/);
  assert.equal(cap.headers["x-goog-api-key"], "g");
  assert.equal(cap.body.systemInstruction.parts[0].text.includes('"tr"'), true);
  assert.equal(out.citations[0].slug, "durable/x/1");
  assert.match(out.answer, /\[1\]/);
});

test("AnthropicSynthesizer: HTTP hatası fail-loud", async () => {
  const s = new AnthropicSynthesizer({ apiKey: "x", fetchImpl: async () => ({ ok: false, status: 429, async text() { return "rate"; }, async json() { return {}; } }) });
  await assert.rejects(() => s.synthesize("q", [hit("a/b", "c")], {}), /HTTP 429/);
});

// --- Factory dispatch ------------------------------------------------------

test("embedderFromEnv: provider dispatch + geriye uyumluluk", () => {
  assert.ok(embedderFromEnv({}) instanceof HashingEmbedder); // varsayılan offline
  assert.ok(embedderFromEnv({ OPENAI_API_KEY: "x" }) instanceof OpenAIEmbedder); // eski yol
  assert.ok(embedderFromEnv({ VITRUS_EMBED_PROVIDER: "hashing" }) instanceof HashingEmbedder);
  assert.ok(embedderFromEnv({ VITRUS_EMBED_PROVIDER: "gemini", GEMINI_API_KEY: "g" }) instanceof GeminiEmbedder);
  assert.ok(embedderFromEnv({ VITRUS_EMBED_PROVIDER: "cohere", COHERE_API_KEY: "c" }) instanceof CohereEmbedder);
  assert.throws(() => embedderFromEnv({ VITRUS_EMBED_PROVIDER: "gemini" }), /GEMINI_API_KEY/);
  assert.throws(() => embedderFromEnv({ VITRUS_EMBED_PROVIDER: "bogus" }), /unknown/);
});

test("synthesizerFromEnv: provider dispatch + geriye uyumluluk", () => {
  assert.ok(synthesizerFromEnv({}) instanceof ExtractiveSynthesizer);
  assert.ok(synthesizerFromEnv({ OPENAI_API_KEY: "x" }) instanceof LLMSynthesizer); // eski yol korunur
  assert.ok(synthesizerFromEnv({ OPENAI_API_KEY: "x", VITRUS_LLM_SYNTH: "0" }) instanceof ExtractiveSynthesizer);
  assert.ok(synthesizerFromEnv({ VITRUS_SYNTH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a" }) instanceof AnthropicSynthesizer);
  assert.ok(synthesizerFromEnv({ VITRUS_SYNTH_PROVIDER: "gemini", GEMINI_API_KEY: "g" }) instanceof GeminiSynthesizer);
  assert.ok(synthesizerFromEnv({ VITRUS_SYNTH_PROVIDER: "ollama" }) instanceof LLMSynthesizer); // yerel, anahtarsız
  assert.throws(() => synthesizerFromEnv({ VITRUS_SYNTH_PROVIDER: "anthropic" }), /ANTHROPIC_API_KEY/);
  assert.throws(() => synthesizerFromEnv({ VITRUS_SYNTH_PROVIDER: "bogus" }), /unknown/);
});
