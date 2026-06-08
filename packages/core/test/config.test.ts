import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, renderConfig } from "../src/core/config.js";

test("resolveConfig: backend seçimi (env-güdümlü)", () => {
  assert.equal(resolveConfig({}).backend, "pglite");
  assert.equal(resolveConfig({ VITRUS_PG_URL: "postgres://x" }).backend, "postgres");
  assert.equal(resolveConfig({ DATABASE_URL: "postgres://x" }).backend, "postgres");
});

test("resolveConfig: varsayılan offline (anahtarsız)", () => {
  const c = resolveConfig({});
  assert.match(c.embedder, /hashing/);
  assert.match(c.synthesizer, /extractive/);
  assert.equal(c.reranker, "off");
});

test("resolveConfig: sağlayıcı + anahtar durumu — SIR SIZMAZ", () => {
  const c = resolveConfig({
    VITRUS_EMBED_PROVIDER: "gemini", GEMINI_API_KEY: "supersecret",
    VITRUS_SYNTH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "anothersecret",
    VITRUS_RERANK_PROVIDER: "cohere", COHERE_API_KEY: "thirdsecret",
  });
  assert.match(c.embedder, /gemini.*key set/);
  assert.match(c.synthesizer, /anthropic.*key set/);
  assert.match(c.reranker, /cohere.*key set/);
  const dump = JSON.stringify(c);
  assert.equal(dump.includes("supersecret"), false);
  assert.equal(dump.includes("anothersecret"), false);
  assert.equal(dump.includes("thirdsecret"), false);
});

test("resolveConfig: anahtarsız bulut sağlayıcı → NO KEY uyarısı", () => {
  assert.match(resolveConfig({ VITRUS_EMBED_PROVIDER: "openai" }).embedder, /NO KEY/);
  assert.match(resolveConfig({ VITRUS_SYNTH_PROVIDER: "anthropic" }).synthesizer, /NO KEY/);
});

test("resolveConfig: routing rozeti + forced extractive", () => {
  assert.match(resolveConfig({ OPENAI_API_KEY: "k", VITRUS_SYNTH_ROUTE: "1" }).synthesizer, /routing/);
  assert.match(resolveConfig({ OPENAI_API_KEY: "k", VITRUS_LLM_SYNTH: "0" }).synthesizer, /extractive/);
});

test("renderConfig: dört satır (backend/embedder/synth/reranker)", () => {
  const out = renderConfig(resolveConfig({}));
  for (const k of ["backend:", "embedder:", "synthesizer:", "reranker:"]) assert.ok(out.includes(k));
});
