import { test } from "node:test";
import assert from "node:assert/strict";
import { LLMSynthesizer, synthesizerFromEnv } from "../src/core/llm-synthesizer.js";
import { ExtractiveSynthesizer } from "../src/core/synthesizer.js";
import type { SearchHit, KnowledgeNode } from "../src/core/types.js";

function hit(slug: string, content: string): SearchHit {
  const node: KnowledgeNode = {
    id: slug,
    slug,
    type: "note",
    tier: "durable",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    createdAt: "",
    updatedAt: "",
    contentHash: "",
  };
  return { node, score: 0.1 };
}

test("LLMSynthesizer: hedef dilde, sabit-eşlemeli kaynaklı cevap; istek doğru kurulur", async () => {
  const cap: { url?: string; body?: any } = {};
  const s = new LLMSynthesizer({
    apiKey: "sk-x",
    fetchImpl: async (url, init) => {
      cap.url = url;
      cap.body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async text() { return ""; },
        async json() { return { choices: [{ message: { content: "Rate limit is 500 rps [1]." } }] }; },
      };
    },
  });
  const out = await s.synthesize("rate limit", [hit("durable/decisions/0007", "Rate-limit 500 rps.")], { lang: "en" });

  assert.match(out.answer, /\[1\]/);
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].slug, "durable/decisions/0007"); // grounding sabit-eşleme
  assert.match(cap.url!, /\/chat\/completions$/);
  assert.match(cap.body.messages[0].content, /"en"/); // sistem prompt hedef dili taşır
  assert.match(cap.body.messages[1].content, /durable\/decisions\/0007/); // kaynaklar promptta
  assert.equal(cap.body.temperature, 0);
});

test("LLMSynthesizer: kaynak yoksa LLM çağrısı YOK, dürüst not-found", async () => {
  let called = false;
  const s = new LLMSynthesizer({
    apiKey: "x",
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, async text() { return ""; }, async json() { return { choices: [] }; } };
    },
  });
  const out = await s.synthesize("x", [], { lang: "en" });
  assert.equal(called, false);
  assert.equal(out.citations.length, 0);
  assert.match(out.answer, /No sourced content/);
});

test("LLMSynthesizer: HTTP hatası fail-loud", async () => {
  const s = new LLMSynthesizer({
    apiKey: "x",
    fetchImpl: async () => ({ ok: false, status: 500, async text() { return "boom"; }, async json() { return {}; } }),
  });
  await assert.rejects(() => s.synthesize("q", [hit("a/b", "c")], {}), /HTTP 500/);
});

test("synthesizerFromEnv: no key → Extractive; key → LLM; VITRUS_LLM_SYNTH=0 → Extractive", () => {
  assert.ok(synthesizerFromEnv({}) instanceof ExtractiveSynthesizer);
  assert.ok(synthesizerFromEnv({ OPENAI_API_KEY: "x" }) instanceof LLMSynthesizer);
  assert.ok(synthesizerFromEnv({ OPENAI_API_KEY: "x", VITRUS_LLM_SYNTH: "0" }) instanceof ExtractiveSynthesizer);
});
