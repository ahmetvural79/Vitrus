// src/eval/bench/harness.ts
// C1 — benchmark harness'ı. Dataset'i TAZE bir beyne ingest eder, her soruyu search/think'ten
// geçirir, retrieval recall + cevap doğruluğunu kategori kırılımıyla raporlar. Deterministik
// (sabit motor + sabit dataset → aynı rapor). Gerçek embedder ile gerçek-dünya SOTA ölçümü.

import type { BrainEngine } from "../../core/engine.js";
import type { BenchDataset, BenchReport, BenchCaseResult } from "./types.js";

const BENCH_PREFIX = "working/bench/";

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function runBenchmark(
  engine: Pick<BrainEngine, "putNode" | "search" | "think">,
  dataset: BenchDataset,
  opts: { topK?: number } = {}
): Promise<BenchReport> {
  const topK = opts.topK ?? 8;

  for (const item of dataset.items) {
    await engine.putNode({
      slug: BENCH_PREFIX + item.id,
      type: "note",
      tier: "working",
      title: item.id,
      content: item.content,
      frontmatter: {},
      salience: 0.5,
      provenance: { connector: "bench", sourceId: item.id, uri: null, capturedAt: item.capturedAt ?? null },
      acl: [],
      contentHash: "bench-" + item.id,
      scope: item.scope,
    });
  }

  const cases: BenchCaseResult[] = [];
  for (const q of dataset.queries) {
    const hits = await engine.search(q.question, { limit: topK });
    const got = hits.map((h) => h.node.slug);
    const expect = q.expectSources.map((id) => BENCH_PREFIX + id);
    const found = expect.filter((s) => got.includes(s)).length;
    const recall = expect.length ? found / expect.length : 1;
    let answerHit: boolean | null = null;
    if (q.expectAnswer) {
      const r = await engine.think(q.question);
      answerHit = norm(r.answer).includes(norm(q.expectAnswer));
    }
    cases.push({ id: q.id, category: q.category ?? "default", recall, hit: recall === 1, expect, got: got.slice(0, topK), answerHit });
  }

  const total = cases.length;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const answerCases = cases.filter((c) => c.answerHit !== null);
  const correct = answerCases.filter((c) => c.answerHit).length;

  const categories: BenchReport["categories"] = {};
  for (const cat of [...new Set(cases.map((c) => c.category))].sort()) {
    const cc = cases.filter((c) => c.category === cat);
    const ac = cc.filter((c) => c.answerHit !== null);
    categories[cat] = {
      total: cc.length,
      hitRate: round(cc.filter((c) => c.hit).length / cc.length),
      answerAccuracy: ac.length ? round(ac.filter((c) => c.answerHit).length / ac.length) : 0,
    };
  }

  return {
    name: dataset.name,
    total,
    topK,
    retrieval: {
      recall: total ? round(cases.reduce((s, c) => s + c.recall, 0) / total) : 1,
      hitRate: total ? round(cases.filter((c) => c.hit).length / total) : 1,
    },
    answer: { total: answerCases.length, correct, accuracy: answerCases.length ? round(correct / answerCases.length) : 0 },
    categories,
    cases,
  };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function renderBenchReport(r: BenchReport): string {
  const out: string[] = [`Vitrus benchmark · ${r.name} · topK=${r.topK} · ${r.total} queries`, ""];
  out.push(`RETRIEVAL: recall ${pct(r.retrieval.recall)} · hit-rate ${pct(r.retrieval.hitRate)}`);
  out.push(`ANSWER: ${r.answer.correct}/${r.answer.total} correct · accuracy ${pct(r.answer.accuracy)}`);
  out.push("", "by category:");
  for (const [cat, c] of Object.entries(r.categories))
    out.push(`  ${cat}: retrieval ${pct(c.hitRate)} · answer ${pct(c.answerAccuracy)} (n=${c.total})`);
  return out.join("\n");
}
