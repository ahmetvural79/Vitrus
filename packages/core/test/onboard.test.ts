// M2: onboarding — curriculum (graf traversal) + quiz (verify-notlu). Deterministik, brain fixture üstü.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCurriculum } from "../src/onboard/curriculum.js";
import { generateQuiz, gradeAnswer } from "../src/onboard/quiz.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("buildCurriculum: kaynaklı, sıralı yol üretir", async () => {
  const e = await buildEngine();
  try {
    const c = await buildCurriculum(e, "platform team services", { limit: 12 });
    assert.ok(c.steps.length > 0, "adım üretmeli");
    assert.ok(c.steps.every((s) => s.slug && s.why && s.type), "her adım slug+neden+tip taşımalı");
    assert.ok(Array.isArray(c.gaps), "gap-flywheel alanı");
  } finally {
    await e.close();
  }
});

test("generateQuiz: anlamlı sorular üretir (oturum/source hariç)", async () => {
  const e = await buildEngine();
  try {
    const qs = await generateQuiz(e, "gateway incident rate limit", { count: 4 });
    assert.ok(qs.length > 0, "soru üretmeli");
    assert.ok(qs.every((q) => q.question.length > 8 && q.slug), "her soru anlamlı + kaynaklı");
    assert.ok(qs.every((q) => !["session", "source", "note"].includes(q.type)), "uygunsuz tipler elenir");
  } finally {
    await e.close();
  }
});

test("gradeAnswer: alakasız cevap deterministik 0 (verify=unsupported)", async () => {
  const e = await buildEngine();
  try {
    const bad = await gradeAnswer(e, "the moon is made of cheese and totally unrelated zzqqxx nonsense");
    assert.equal(bad.score, 0, "desteksiz → 0");
    assert.ok(["unsupported", "contradicted"].includes(bad.verdict));
  } finally {
    await e.close();
  }
});
