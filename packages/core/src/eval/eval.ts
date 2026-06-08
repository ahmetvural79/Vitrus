// src/eval/eval.ts
// Determinist eval motoru. Motor (yerel embedder + LLM'siz graf/gap) deterministik
// olduğundan iki koşu birebir aynı sonucu verir → tekrarlanabilir kanıt.
//
// Üç ölçüt (CamKutu roadmap §6):
//  - Kaynak isabeti: doğru kaynak top-K'da mı (hendek görünürlük → kaynak yanlışsa fail).
//  - Boşluk recall: bilerek bırakılmış boşluklar işaretlendi mi.
//  - Boşluk precision: uydurma boşluk YOK (uydurma-"biliyorum" en ağır hata).

import type { BrainEngine } from "../core/engine.js";
import { RETRIEVAL_CASES, GAP_CASES, type GapCase } from "./dataset.js";

export interface RetrievalResult {
  id: string;
  query: string;
  expect: string[];
  got: string[];
  pass: boolean;
}

export interface EvalReport {
  version: string; // determinist koşum damgası
  topK: number;
  retrieval: { total: number; passed: number; rate: number; cases: RetrievalResult[] };
  gaps: {
    recall: number;
    precision: number;
    detected: number;
    matched: string[];
    missing: string[]; // tespit EDİLEMEYEN beklenen boşluklar
    spurious: number; // beklenmeyen (uydurma) boşluk sayısı
  };
  gates: { sourceHit: number; gapRecall: number; gapPrecision: number };
  ok: boolean;
}

const GATES = { sourceHit: 0.9, gapRecall: 1.0, gapPrecision: 1.0 };

function matchesGap(g: { kind: string; message: string; relatedNodeIds: string[] }, c: GapCase): boolean {
  return g.kind === c.kind && (g.message.includes(c.match) || g.relatedNodeIds.includes(c.match));
}

export async function runEval(engine: BrainEngine, opts: { topK?: number } = {}): Promise<EvalReport> {
  const topK = opts.topK ?? 8;

  // --- kaynak isabeti ---
  const cases: RetrievalResult[] = [];
  for (const c of RETRIEVAL_CASES) {
    const hits = await engine.search(c.query, { limit: topK });
    const got = hits.map((h) => h.node.slug);
    cases.push({ id: c.id, query: c.query, expect: c.expect, got, pass: c.expect.every((s) => got.includes(s)) });
  }
  const passed = cases.filter((c) => c.pass).length;
  const rate = cases.length ? passed / cases.length : 1;

  // --- boşluk tespiti ---
  const gaps = await engine.findGaps();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const c of GAP_CASES) {
    (gaps.some((g) => matchesGap(g, c)) ? matched : missing).push(c.label);
  }
  const recall = GAP_CASES.length ? matched.length / GAP_CASES.length : 1;
  // precision: tespit edilen her boşluk beklenen bir vakaya karşılık geliyor mu?
  const matchedDetected = gaps.filter((g) => GAP_CASES.some((c) => matchesGap(g, c))).length;
  const precision = gaps.length ? matchedDetected / gaps.length : 1;
  const spurious = gaps.length - matchedDetected;

  const ok = rate >= GATES.sourceHit && recall >= GATES.gapRecall && precision >= GATES.gapPrecision;

  return {
    version: `embedder=hashing-1536 · rrf-k=60 · topK=${topK} · cases=${RETRIEVAL_CASES.length}/${GAP_CASES.length}`,
    topK,
    retrieval: { total: cases.length, passed, rate: Math.round(rate * 1000) / 1000, cases },
    gaps: {
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      detected: gaps.length,
      matched,
      missing,
      spurious,
    },
    gates: GATES,
    ok,
  };
}

/** Raporu insan-okunur metne çevirir. */
export function renderReport(r: EvalReport): string {
  const out: string[] = [];
  out.push(`Vitrus eval · ${r.version}`, "");
  out.push(`SOURCE HIT: ${Math.round(r.retrieval.rate * 100)}% (${r.retrieval.passed}/${r.retrieval.total}) · gate ≥${Math.round(r.gates.sourceHit * 100)}%`);
  for (const c of r.retrieval.cases) {
    if (!c.pass) out.push(`  ✗ ${c.id}: "${c.query}" → expected ${c.expect.join(",")} · top-${r.topK}: ${c.got.slice(0, 5).join(", ")}`);
  }
  out.push("");
  out.push(`GAP RECALL: ${Math.round(r.gaps.recall * 100)}% (gate 100%) · PRECISION: ${Math.round(r.gaps.precision * 100)}% (spurious: ${r.gaps.spurious})`);
  for (const m of r.gaps.missing) out.push(`  ✗ not detected: ${m}`);
  out.push("");
  out.push(r.ok ? "✓ ALL GATES PASSED" : "✗ GATE FAILED");
  return out.join("\n");
}
