import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLoCoMo, loadLongMemEval, detectFormat, loadDataset, limitDataset } from "../src/eval/bench/loaders.js";
import { runBenchmark } from "../src/eval/bench/harness.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

const LOCOMO = [
  {
    conversation: {
      session_1_date_time: "1:56 pm on 8 May, 2023",
      session_1: [
        { speaker: "Alice", text: "ödeme servisi çöktü", dia_id: "D1:1" },
        { speaker: "Bob", text: "runbook ile düzelttik", dia_id: "D1:2" },
      ],
      session_2: [{ speaker: "Alice", text: "tatil planı yapalım", dia_id: "D2:1" }],
    },
    qa: [{ question: "ödeme servisi nasıl düzeldi runbook", answer: "runbook", evidence: ["D1:2"], category: "single" }],
  },
];

const LONGMEM = [
  { question_id: "q1", question: "rate limit?", answer: "500", haystack_sessions: ["limit is 500"], answer_session_ids: ["q1-s0"] },
];

test("loadLoCoMo: session'lar item, qa evidence → session item'ına eşlenir", () => {
  const ds = loadLoCoMo(LOCOMO);
  assert.equal(ds.items.length, 2);
  assert.equal(ds.queries.length, 1);
  assert.deepEqual(ds.queries[0].expectSources, ["s0-session_1"]); // D1:2 → session_1
  assert.equal(ds.items.find((i) => i.id === "s0-session_1")?.capturedAt, "1:56 pm on 8 May, 2023");
  assert.match(ds.items[0].content, /Alice: ödeme servisi çöktü/);
});

test("detectFormat + loadDataset: LoCoMo ve LongMemEval'i ayırır", () => {
  assert.equal(detectFormat(LOCOMO), "locomo");
  assert.equal(detectFormat(LONGMEM), "longmemeval");
  assert.equal(loadDataset(LOCOMO).name, "LoCoMo (loaded)");
  assert.equal(loadDataset(LONGMEM).name, "LongMemEval (loaded)");
  assert.equal(loadDataset(LONGMEM, "longmemeval").queries.length, 1);
});

test("limitDataset: soruları sınırlar, item'ları (haystack) korur", () => {
  const ds = loadDataset(LOCOMO);
  const lim = limitDataset({ ...ds, queries: [ds.queries[0], { ...ds.queries[0], id: "extra" }] }, 1);
  assert.equal(lim.queries.length, 1);
  assert.equal(lim.items.length, ds.items.length); // haystack tam
});

test("harness LoCoMo dataset'ini koşar: beklenen kaynak top-K'da (recall)", async () => {
  const ds = loadLoCoMo(LOCOMO);
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  const report = await runBenchmark(engine, ds, { topK: 8 });
  assert.equal(report.total, 1);
  assert.equal(report.retrieval.recall, 1); // 2 item, topK=8 → beklenen session getirilir
  await engine.close();
});
