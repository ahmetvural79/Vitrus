// src/eval/bench/latency.ts
// C2 — retrieval gecikme ölçümü. search/think p50/p95/p99 (in-process, ağ hop'u YOK —
// voice-AI tezindeki kaldıraç). Rapor amaçlı (sabit ms kapısı ortam-bağımlı/flaky olur);
// opsiyonel `--gate <ms>` runner'da p99 eşiğini zorlar.

import type { BrainEngine } from "../../core/engine.js";

export interface LatencyStats {
  runs: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}
export interface LatencyReport {
  search: LatencyStats;
  think: LatencyStats;
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function stats(times: number[]): LatencyStats {
  const s = [...times].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    runs: s.length,
    p50: round(pctile(s, 50)),
    p95: round(pctile(s, 95)),
    p99: round(pctile(s, 99)),
    mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1)),
    max: round(s[s.length - 1] ?? 0),
  };
}

export async function measureLatency(
  engine: Pick<BrainEngine, "search" | "think">,
  queries: string[],
  opts: { runs?: number; warmup?: number } = {}
): Promise<LatencyReport> {
  const runs = opts.runs ?? 50;
  const warmup = opts.warmup ?? 5;
  const pick = (i: number) => queries[i % queries.length] ?? "";

  for (let i = 0; i < warmup; i++) {
    await engine.search(pick(i));
    await engine.think(pick(i));
  }
  const searchT: number[] = [];
  const thinkT: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    await engine.search(pick(i));
    searchT.push(performance.now() - t);
    t = performance.now();
    await engine.think(pick(i));
    thinkT.push(performance.now() - t);
  }
  return { search: stats(searchT), think: stats(thinkT) };
}

export function renderLatency(r: LatencyReport): string {
  const line = (name: string, s: LatencyStats) =>
    `  ${name.padEnd(7)} p50 ${s.p50}ms · p95 ${s.p95}ms · p99 ${s.p99}ms · mean ${s.mean}ms · max ${s.max}ms (${s.runs} runs)`;
  return ["Vitrus latency (in-process, no network hop)", line("search", r.search), line("think", r.think)].join("\n");
}
