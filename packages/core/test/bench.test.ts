import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { SAMPLE_DATASET } from "../src/eval/bench/sample.js";
import { runBenchmark } from "../src/eval/bench/harness.js";
import { measureLatency } from "../src/eval/bench/latency.js";
import { loadLongMemEval } from "../src/eval/bench/loaders.js";

async function engine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

test("runBenchmark: sample dataset → recall + cevap skorları hesaplanır (C1)", async () => {
  const e = await engine();
  try {
    const r = await runBenchmark(e, SAMPLE_DATASET);
    assert.equal(r.total, 4);
    assert.ok(r.retrieval.recall >= 0 && r.retrieval.recall <= 1);
    assert.equal(r.answer.total, 4); // hepsinin beklenen cevabı var
    // q1 (allergic→peanuts) offline'da net: tam retrieval + doğru cevap
    const q1 = r.cases.find((c) => c.id === "q1")!;
    assert.equal(q1.recall, 1);
    assert.equal(q1.answerHit, true);
    assert.ok(r.categories["single-session"]);
  } finally {
    await e.close();
  }
});

test("runBenchmark: deterministik (iki koşu birebir aynı)", async () => {
  const a = await engine();
  const b = await engine();
  try {
    assert.equal(JSON.stringify(await runBenchmark(a, SAMPLE_DATASET)), JSON.stringify(await runBenchmark(b, SAMPLE_DATASET)));
  } finally {
    await a.close();
    await b.close();
  }
});

test("measureLatency: p50 ≤ p99, doğru run sayısı (C2 şekil)", async () => {
  const e = await engine();
  try {
    await runBenchmark(e, SAMPLE_DATASET); // korpusu doldur
    const r = await measureLatency(e, SAMPLE_DATASET.queries.map((q) => q.question), { runs: 10, warmup: 2 });
    assert.equal(r.search.runs, 10);
    assert.ok(r.search.p50 <= r.search.p99 + 1e-9);
    assert.ok(r.think.p99 >= 0 && r.think.mean >= 0);
  } finally {
    await e.close();
  }
});

test("loadLongMemEval: toleranslı parse (BYO dataset şekli)", () => {
  const ds = loadLongMemEval([
    {
      question_id: "x1",
      question: "where do they work",
      question_type: "single",
      answer: "Acme",
      haystack_sessions: [[{ role: "user", content: "I work at Acme" }]],
      haystack_session_ids: ["sa"],
      answer_session_ids: ["sa"],
    },
  ]);
  assert.equal(ds.queries.length, 1);
  assert.equal(ds.items.length, 1);
  assert.equal(ds.queries[0].expectSources[0], "sa");
  assert.equal(ds.queries[0].expectAnswer, "Acme");
  assert.match(ds.items[0].content, /I work at Acme/);
});
