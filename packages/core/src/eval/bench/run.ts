#!/usr/bin/env bun
// src/eval/bench/run.ts
//   bun run bench [-- --dataset <path>] [--format longmemeval|locomo] [--limit N] [--topk N] [--gate <ms>]
// Gömülü sample (offline) ya da --dataset ile BYO LongMemEval/LoCoMo (format otomatik algılanır).
// Embedder/reranker env'den: OPENAI_API_KEY/VITRUS_EMBED_PROVIDER → gerçek embedder;
// VITRUS_RERANK_PROVIDER → cross-encoder rerank (gerçek-dünya SOTA ölçümü). Yoksa offline.

import { readFileSync } from "node:fs";
import { PgliteEngine } from "../../core/pglite-engine.js";
import { embedderFromEnv } from "../../core/openai-embedder.js";
import { rerankerFromEnv } from "../../core/reranker.js";
import { SAMPLE_DATASET } from "./sample.js";
import { loadDataset, limitDataset } from "./loaders.js";
import { runBenchmark, renderBenchReport } from "./harness.js";
import { measureLatency, renderLatency } from "./latency.js";

const argv = process.argv;
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const dsPath = flag("--dataset");
const fmt = flag("--format") as "longmemeval" | "locomo" | undefined;
const limit = flag("--limit") ? Number(flag("--limit")) : undefined;
let dataset = dsPath ? loadDataset(JSON.parse(readFileSync(dsPath, "utf8")), fmt) : SAMPLE_DATASET;
if (limit) dataset = limitDataset(dataset, limit);
const topK = flag("--topk") ? Number(flag("--topk")) : 8;
const gateMs = flag("--gate") ? Number(flag("--gate")) : null;

const engine = new PgliteEngine({ embedder: embedderFromEnv(), reranker: rerankerFromEnv() });
await engine.init();

const report = await runBenchmark(engine, dataset, { topK });
console.log(renderBenchReport(report));
console.log("");

const latency = await measureLatency(engine, dataset.queries.map((q) => q.question));
console.log(renderLatency(latency));
await engine.close();

if (gateMs !== null && latency.think.p99 > gateMs) {
  console.error(`\n✗ latency gate: think p99 ${latency.think.p99}ms > ${gateMs}ms`);
  process.exit(1);
}
